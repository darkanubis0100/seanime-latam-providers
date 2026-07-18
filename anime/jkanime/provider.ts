/// <reference path="./online-streaming-provider.d.ts" />

type JkCandidate = {
    url: string
    server: string
    language: string
}

type JkEpisodesPage = {
    data?: Array<{ title?: string; number?: number; timestamp?: string }>
    current_page?: number
    last_page?: number
    from?: number
    to?: number
    total?: number
}

const JK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

function jkHeaders(referer: string): Record<string, string> {
    return {
        "User-Agent": JK_UA,
        "Referer": referer,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
}

function jkAbsoluteUrl(value: string, base: string): string {
    const cleaned = value.trim().replace(/\\\//g, "/").replace(/&amp;/g, "&")
    if (!cleaned) return ""
    if (cleaned.startsWith("//")) return `https:${cleaned}`
    try { return new URL(cleaned, base).toString() } catch (_) { return cleaned }
}

function jkUnique(values: string[]): string[] {
    const seen: Record<string, boolean> = {}
    const result: string[] = []
    for (const value of values) {
        const item = value.trim()
        if (!item || seen[item]) continue
        seen[item] = true
        result.push(item)
    }
    return result
}

function jkVideoType(url: string): "mp4" | "m3u8" {
    return /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4"
}

function jkQuality(url: string, fallback: string): string {
    const match = url.match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/i)
    return match ? `${fallback} ${match[1]}p` : fallback
}

function jkEscapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function jkDecodeJsString(value: string, quote: string): string {
    try { return Function(`"use strict"; return ${quote}${value}${quote};`)() as string } catch (_) {
        return value.replace(/\\\//g, "/").replace(/\\'/g, "'").replace(/\\"/g, '"')
    }
}

function jkBaseToken(value: number, radix: number): string {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if (value === 0) return "0"
    let number = value
    let output = ""
    const safeRadix = Math.max(2, Math.min(radix, alphabet.length))
    while (number > 0) {
        output = alphabet[number % safeRadix] + output
        number = Math.floor(number / safeRadix)
    }
    return output
}

function jkUnpackPacker(source: string): string[] {
    const output: string[] = []
    const patterns = [
        /eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/g,
        /eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\(\s*"([\s\S]*?)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([\s\S]*?)"\.split\("\|"\)/g,
    ]
    for (let p = 0; p < patterns.length; p++) {
        const regex = patterns[p]
        let match: RegExpExecArray | null
        while ((match = regex.exec(source)) !== null) {
            const quote = p === 0 ? "'" : '"'
            let payload = jkDecodeJsString(match[1], quote)
            const radix = Number(match[2])
            const count = Number(match[3])
            const symbols = jkDecodeJsString(match[4], quote).split("|")
            for (let i = count - 1; i >= 0; i--) {
                if (!symbols[i]) continue
                payload = payload.replace(new RegExp(`\\b${jkEscapeRegExp(jkBaseToken(i, radix))}\\b`, "g"), symbols[i])
            }
            output.push(payload)
        }
    }
    return output
}

function jkCollectMediaUrls(text: string, base: string): string[] {
    const output: string[] = []
    const patterns = [
        /https?:\\?\/\\?\/[^'"\s<>]+?\.(?:m3u8|mp4)(?:\?[^'"\s<>]*)?/gi,
        /(?:file|source|src|url)\s*[:=]\s*['"]([^'"]+\.(?:m3u8|mp4)(?:\?[^'"]*)?)['"]/gi,
        /<source[^>]+src=['"]([^'"]+)['"]/gi,
        /<video[^>]+src=['"]([^'"]+)['"]/gi,
    ]
    for (const regex of patterns) {
        let match: RegExpExecArray | null
        while ((match = regex.exec(text)) !== null) {
            const raw = match[1] || match[0]
            const normalized = jkAbsoluteUrl(raw.replace(/^['"]|['"]$/g, ""), base)
            if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(normalized)) output.push(normalized)
        }
    }
    return jkUnique(output)
}

function jkAtob(value: string): string {
    try { return atob(value) } catch (_) { return "" }
}

function jkRot13(input: string): string {
    return input.replace(/[A-Za-z]/g, (character) => {
        const code = character.charCodeAt(0)
        const base = code <= 90 ? 65 : 97
        return String.fromCharCode(((code - base + 13) % 26) + base)
    })
}

function jkCookieHeader(response: Response): string {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    let values: string[] = []
    if (typeof headers.getSetCookie === "function") values = headers.getSetCookie()
    if (values.length === 0) {
        const raw = response.headers.get("set-cookie") || ""
        if (raw) values = raw.split(/,\s*(?=[^;,\s]+=)/)
    }
    return values.map((value) => value.split(";")[0]).filter(Boolean).join("; ")
}

function jkLanguage(value: number | string | undefined): string {
    const code = Number(value)
    if (code === 1) return "[JAP]"
    if (code === 3) return "[LAT]"
    if (code === 4) return "[CHIN]"
    return ""
}

function jkClassify(candidate: JkCandidate): string {
    const value = `${candidate.server} ${candidate.url}`.toLowerCase()
    const aliases: Array<[string, string[]]> = [
        ["Voe", ["voe", "tubelessceliolymph", "simpulumlamerop", "urochsunloath", "metagnathtuggers", "donaldlineelse"]],
        ["Okru", ["ok.ru", "okru"]],
        ["Filemoon", ["filemoon", "moonplayer", "moviesm4u", "files.im"]],
        ["StreamTape", ["streamtape", "stp", "stape", "shavetape"]],
        ["Mp4Upload", ["mp4upload"]],
        ["MixDrop", ["mixdrop", "mxdrop", "mdbekjwqa"]],
        ["StreamWish", ["sfastwish", "wishembed", "streamwish", "strwish", "iplayerhls", "streamgg"]],
        ["DoodStream", ["d-s.io", "dsvplay", "dood"]],
        ["Desuka", ["stream/jkmedia"]],
        ["Nozomi", ["jkplayer/um2?", "um2.php", "nozomi"]],
        ["Desu", ["jkplayer/um?", "um.php"]],
        ["Magi", ["jkplayer/umv?"]],
        ["Mediafire", ["mediafire"]],
    ]
    for (const [name, needles] of aliases) {
        if (needles.some((needle) => value.includes(needle))) return name
    }
    return candidate.server || "Mirror"
}

async function jkExtractStreamTape(url: string, label: string): Promise<VideoSource[]> {
    const parts = url.split("/").filter(Boolean)
    const id = parts.length > 0 ? parts[parts.length - 1].split("?")[0] : ""
    const embed = id ? `https://streamtape.com/e/${id}` : url
    const response = await fetch(embed, { headers: jkHeaders(embed) })
    const html = await response.text()
    const match = html.match(/robotlink['"]?\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('xcd([^']+)'/i)
        || html.match(/robotlink['"]?\)\.innerHTML\s*=\s*"([^"]+)"\s*\+\s*\("xcd([^"]+)"/i)
    const urls: string[] = []
    if (match) urls.push(jkAbsoluteUrl(`https:${match[1]}${match[2]}`, embed))
    urls.push(...jkCollectMediaUrls(html, response.url || embed))
    return jkUnique(urls).map((item) => ({ url: item, type: jkVideoType(item), quality: jkQuality(item, label), subtitles: [] }))
}

async function jkExtractOkru(url: string, label: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: jkHeaders(url) })
    const html = await response.text()
    const $ = LoadDoc(html)
    const raw = String($("[data-module='OKVideo']").first().attr("data-options") || "")
    if (!raw) return []
    try {
        const textArea = LoadDoc(`<textarea>${raw}</textarea>`)
        const decoded = String(textArea("textarea").text() || raw)
        const options = JSON.parse(decoded) as { flashvars?: { metadata?: string | Record<string, unknown> } }
        const rawMetadata = options.flashvars?.metadata
        const metadata = typeof rawMetadata === "string" ? JSON.parse(rawMetadata) as Record<string, unknown> : rawMetadata || {}
        const urls: string[] = []
        if (typeof metadata.hlsManifestUrl === "string") urls.push(metadata.hlsManifestUrl)
        if (Array.isArray(metadata.videos)) {
            for (const video of metadata.videos as Array<{ url?: string }>) if (video.url) urls.push(video.url)
        }
        return jkUnique(urls).map((item) => ({ url: item, type: jkVideoType(item), quality: jkQuality(item, label), subtitles: [] }))
    } catch (_) { return [] }
}

async function jkExtractVoe(url: string, label: string): Promise<VideoSource[]> {
    let response = await fetch(url, { headers: jkHeaders(url) })
    let html = await response.text()
    const redirect = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i)
    if (redirect) {
        const redirected = jkAbsoluteUrl(redirect[1], response.url || url)
        response = await fetch(redirected, { headers: jkHeaders(url) })
        html = await response.text()
    }
    const $ = LoadDoc(html)
    let encoded = String($("script[type='application/json']").first().text() || $("script[type='application/json']").first().html() || "").trim()
    encoded = encoded.replace(/^\[\s*"/, "").replace(/"\s*\]$/, "")
    if (!encoded) return []
    try {
        const replaced = jkRot13(encoded).replace(/@\$|\^\^|~@|%\?|\*~|!!|#&/g, "_").replace(/_/g, "")
        const first = jkAtob(replaced)
        let shifted = ""
        for (let i = 0; i < first.length; i++) shifted += String.fromCharCode(first.charCodeAt(i) - 3)
        const jsonText = jkAtob(shifted.split("").reverse().join(""))
        const data = JSON.parse(jsonText) as { source?: string; direct_access_url?: string }
        return jkUnique([data.source || "", data.direct_access_url || ""]).map((item) => ({
            url: item, type: jkVideoType(item), quality: jkQuality(item, label), subtitles: [],
        }))
    } catch (_) { return [] }
}

async function jkExtractDood(url: string, label: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: jkHeaders(url) })
    const html = await response.text()
    const pass = html.match(/['"](\/pass_md5\/[^'"]+)['"]/)
    if (!pass) return []
    const passUrl = jkAbsoluteUrl(pass[1], response.url || url)
    const token = html.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1] || html.match(/token\s*=\s*['"]([^'"]+)/)?.[1] || ""
    const expiry = html.match(/expiry\s*=\s*['"]?(\d+)/)?.[1] || String(Date.now())
    const passResponse = await fetch(passUrl, { headers: jkHeaders(response.url || url) })
    const prefix = (await passResponse.text()).trim()
    if (!prefix.startsWith("http")) return []
    const separator = prefix.includes("?") ? "&" : "?"
    const finalUrl = `${prefix}${Math.random().toString(36).slice(2, 12)}${separator}token=${encodeURIComponent(token)}&expiry=${encodeURIComponent(expiry)}`
    return [{ url: finalUrl, type: "mp4", quality: label, subtitles: [] }]
}

async function jkExtractGeneric(url: string, label: string, referer: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: jkHeaders(referer) })
    const contentType = response.headers.get("content-type") || ""
    if (contentType.startsWith("video/") || /\.(?:m3u8|mp4)(?:$|[?#])/i.test(response.url)) {
        const finalUrl = response.url || url
        return [{ url: finalUrl, type: jkVideoType(finalUrl), quality: jkQuality(finalUrl, label), subtitles: [] }]
    }
    const html = await response.text()
    const bodies = [html].concat(jkUnpackPacker(html))
    const urls: string[] = []
    for (const body of bodies) urls.push(...jkCollectMediaUrls(body, response.url || url))
    return jkUnique(urls).map((item) => ({ url: item, type: jkVideoType(item), quality: jkQuality(item, label), subtitles: [] }))
}

async function jkExtractNozomi(url: string, label: string): Promise<VideoSource[]> {
    const first = await fetch(url, { headers: jkHeaders(url) })
    const html = await first.text()
    const $ = LoadDoc(html)
    const dataKey = String($("form input[value]").first().attr("value") || "")
    if (!dataKey) return []
    const redirect = await fetch("https://jkanime.net/gsplay/redirect_post.php", {
        method: "POST",
        redirect: "follow",
        headers: { ...jkHeaders(url), "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(dataKey)}`,
    })
    const postKey = (redirect.url || "").split("player.html#")[1] || ""
    if (!postKey) return []
    const api = await fetch("https://jkanime.net/gsplay/api.php", {
        method: "POST",
        headers: { ...jkHeaders(url), "Content-Type": "application/x-www-form-urlencoded" },
        body: `v=${encodeURIComponent(postKey)}`,
    })
    const data = await api.json() as { file?: string }
    if (!data.file) return []
    return [{ url: data.file, type: jkVideoType(data.file), quality: jkQuality(data.file, label), subtitles: [] }]
}

async function jkExtractMediafire(url: string, label: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: jkHeaders(url) })
    const html = await response.text()
    const $ = LoadDoc(html)
    const download = String($("a#downloadButton").first().attr("href") || "")
    if (!download) return []
    const finalUrl = jkAbsoluteUrl(download, response.url || url)
    return [{ url: finalUrl, type: "mp4", quality: label, subtitles: [] }]
}

async function jkExtractCandidate(candidate: JkCandidate, referer: string): Promise<VideoSource[]> {
    const kind = jkClassify(candidate)
    const label = `${candidate.language} ${kind}`.trim()
    if (kind === "StreamTape") return jkExtractStreamTape(candidate.url, label)
    if (kind === "Okru") return jkExtractOkru(candidate.url, label)
    if (kind === "Voe") return jkExtractVoe(candidate.url, label)
    if (kind === "DoodStream") return jkExtractDood(candidate.url.replace("d-s.io", "dsvplay.com"), label)
    if (kind === "Nozomi") return jkExtractNozomi(candidate.url, label)
    if (kind === "Mediafire") return jkExtractMediafire(candidate.url, label)
    return jkExtractGeneric(candidate.url, label, referer)
}

class Provider {
    api = "https://jkanime.net"

    getSettings(): Settings {
        return {
            episodeServers: ["Auto", "Okru", "Voe", "Filemoon", "StreamTape", "Mp4Upload", "MixDrop", "StreamWish", "DoodStream", "Mediafire", "Desuka", "Nozomi", "Desu", "Magi"],
            supportsDub: true,
        }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const query = opts.query.trim().replace(/\s+/g, "_")
        if (!query) return []
        const response = await fetch(`${this.api}/buscar/${encodeURIComponent(query)}`, { headers: jkHeaders(`${this.api}/`) })
        if (!response.ok) return []
        const html = await response.text()
        const $ = LoadDoc(html)
        const output: SearchResult[] = []

        $("div.row div.row.page_directorio div.anime__item").each((_: number, element: unknown) => {
            const item = $(element)
            const anchor = item.find("div.anime__item__text a").first()
            const title = String(anchor.text() || "").trim()
            const href = String(anchor.attr("href") || "")
            const url = jkAbsoluteUrl(href, this.api)
            const id = url.replace(this.api, "").replace(/^\/+|\/+$/g, "")
            if (title && id) output.push({ id, title, url, subOrDub: "both" })
        })

        if (output.length === 0 && $("div.anime__details__content").length > 0) {
            const title = String($("div.anime__details__content div.anime_info h3").first().text() || "").trim()
            const id = (response.url || "").replace(this.api, "").replace(/^\/+|\/+$/g, "")
            if (title && id) output.push({ id, title, url: response.url, subOrDub: "both" })
        }
        return output
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const slug = id.replace(this.api, "").replace(/^\/+|\/+$/g, "")
        const animeUrl = `${this.api}/${slug}`
        const response = await fetch(animeUrl, { headers: jkHeaders(`${this.api}/`) })
        if (!response.ok) return []
        const html = await response.text()
        const $ = LoadDoc(html)
        const output: EpisodeDetails[] = []

        const scriptMatch = html.match(/var\s+episodes\s*=\s*(\[\[[\s\S]*?\]\])\s*;/)
        if (scriptMatch) {
            try {
                const rows = JSON.parse(scriptMatch[1]) as unknown[][]
                for (const row of rows) {
                    const number = Number(row[0])
                    if (!Number.isFinite(number)) continue
                    output.push({ id: `${slug}/${number}`, number, title: `Episodio ${number}`, url: `${animeUrl}/${number}` })
                }
            } catch (_) { /* Use current AJAX endpoint below. */ }
        }

        if (output.length === 0) {
            const token = String($("meta[name='csrf-token']").first().attr("content") || "")
            const animeId = String($("div.anime__details__content div.pc div#guardar-anime").first().attr("data-anime") || "")
            if (token && animeId) {
                const cookies = jkCookieHeader(response)
                const ajax = await fetch(`${this.api}/ajax/episodes/${encodeURIComponent(animeId)}/1`, {
                    method: "POST",
                    headers: {
                        ...jkHeaders(animeUrl),
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        ...(cookies ? { "Cookie": cookies } : {}),
                    },
                    body: `_token=${encodeURIComponent(token)}`,
                })
                if (ajax.ok) {
                    const page = await ajax.json() as JkEpisodesPage
                    for (const episode of page.data || []) {
                        const number = Number(episode.number)
                        if (!Number.isFinite(number)) continue
                        output.push({ id: `${slug}/${number}`, number, title: episode.title || `Episodio ${number}`, url: `${animeUrl}/${number}` })
                    }
                    const from = Number(page.from || 1)
                    const to = Number(page.to || output.length)
                    const total = Number(page.total || output.length)
                    const lastNumber = from + total - 1
                    for (let number = to + 1; number <= lastNumber; number++) {
                        output.push({ id: `${slug}/${number}`, number, title: `Episodio ${number}`, url: `${animeUrl}/${number}` })
                    }
                }
            }
        }

        if (output.length === 0) {
            $("a[href]").each((_: number, element: unknown) => {
                const href = String($(element).attr("href") || "")
                const match = href.match(/\/(\d+(?:\.\d+)?)\/?$/)
                if (!match || !href.includes(slug)) return
                const number = Number(match[1])
                output.push({ id: `${slug}/${number}`, number, title: `Episodio ${number}`, url: jkAbsoluteUrl(href, animeUrl) })
            })
        }

        const deduped: Record<string, EpisodeDetails> = {}
        for (const episode of output) deduped[String(episode.number)] = episode
        return Object.keys(deduped).map((key) => deduped[key]).sort((a, b) => a.number - b.number)
    }

    private async getCandidates(episodeUrl: string): Promise<JkCandidate[]> {
        const response = await fetch(episodeUrl, { headers: jkHeaders(`${this.api}/`) })
        if (!response.ok) return []
        const html = await response.text()
        const $ = LoadDoc(html)
        let scriptBody = ""
        $("script").each((_: number, element: unknown) => { scriptBody += `\n${String($(element).html() || $(element).text() || "")}` })
        const output: JkCandidate[] = []

        let jsonText = ""
        const remote = scriptBody.match(/var\s+remote\s*=\s*['"]([^'"]+)['"]/i)?.[1] || ""
        const remotePath = scriptBody.match(/=\s*remote\s*\+\s*['"]([^'"]+)['"]/i)?.[1] || ""
        if (remote && remotePath) {
            const remoteResponse = await fetch(jkAbsoluteUrl(remotePath, remote), { headers: jkHeaders(episodeUrl) })
            if (remoteResponse.ok) jsonText = await remoteResponse.text()
        } else {
            jsonText = scriptBody.match(/var\s+servers\s*=\s*(\[[\s\S]*?\])\s*;/i)?.[1] || ""
        }

        if (jsonText) {
            try {
                const links = JSON.parse(jsonText) as Array<{ remote?: string; server?: string; lang?: number }>
                for (const link of links) {
                    const decoded = link.remote ? jkAtob(link.remote) : ""
                    if (!decoded) continue
                    output.push({ url: jkAbsoluteUrl(decoded, episodeUrl), server: link.server || "Mirror", language: jkLanguage(link.lang) })
                }
            } catch (_) { /* HTML mirrors below. */ }
        }

        $("div.bg-servers a").each((_: number, element: unknown) => {
            const item = $(element)
            const serverId = String(item.attr("data-id") || "")
            const languageCode = String(item.attr("class") || "").match(/lg_(\d+)/)?.[1]
            const serverName = String(item.text() || "Mirror").trim()
            if (!serverId) return
            const pattern = new RegExp(`video\\[\\s*${jkEscapeRegExp(serverId)}\\s*\\]\\s*=\\s*['\"][\\s\\S]*?src=['\"]([^'\"]+)`, "i")
            const found = scriptBody.match(pattern)?.[1] || ""
            if (!found) return
            const normalized = found
                .replace("/jkokru.php?u=", "https://ok.ru/videoembed/")
                .replace("/jkvmixdrop.php?u=", "https://mixdrop.ag/e/")
                .replace("/jksw.php?u=", "https://sfastwish.com/e/")
                .replace("/jk.php?u=", `${this.api}/`)
            output.push({ url: jkAbsoluteUrl(normalized, episodeUrl), server: serverName, language: jkLanguage(languageCode) })
        })

        const seen: Record<string, boolean> = {}
        return output.filter((candidate) => {
            const key = `${candidate.url}|${candidate.language}`
            if (!candidate.url || seen[key]) return false
            seen[key] = true
            return true
        })
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        let candidates = await this.getCandidates(episode.url)
        const requested = server.toLowerCase()
        if (requested !== "auto") candidates = candidates.filter((candidate) => jkClassify(candidate).toLowerCase() === requested)
        else {
            const order = ["Okru", "Voe", "Filemoon", "StreamTape", "Mp4Upload", "MixDrop", "StreamWish", "DoodStream", "Nozomi", "Desu", "Magi", "Mediafire"]
            candidates.sort((a, b) => {
                const ai = order.indexOf(jkClassify(a))
                const bi = order.indexOf(jkClassify(b))
                return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
            })
        }

        for (const candidate of candidates) {
            try {
                const sources = await jkExtractCandidate(candidate, episode.url)
                if (sources.length > 0) {
                    const name = `${candidate.language} ${jkClassify(candidate)}`.trim()
                    return { server: name, headers: jkHeaders(candidate.url), videoSources: sources }
                }
            } catch (_) { /* Try the next mirror. */ }
        }
        throw new Error(`No se pudo extraer ${server}. Prueba otro servidor o idioma.`)
    }
}
