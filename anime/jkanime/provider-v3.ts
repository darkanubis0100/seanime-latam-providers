/// <reference path="./online-streaming-provider.d.ts" />

type Candidate = { url: string; server: string; language: string }
type EpisodesPage = { data?: Array<{ title?: string; number?: number }>; from?: number; to?: number; total?: number }

const BASE = "https://jkanime.net"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

function headers(referer: string): Record<string, string> {
    return { "User-Agent": UA, Referer: referer, Accept: "*/*" }
}

function absolute(value: string, base: string): string {
    const v = value.trim().replace(/\\\//g, "/").replace(/&amp;/g, "&")
    if (!v) return ""
    if (/^https?:\/\//i.test(v)) return v
    if (v.startsWith("//")) return `https:${v}`
    const origin = base.match(/^(https?:\/\/[^/]+)/i)?.[1] || BASE
    return v.startsWith("/") ? origin + v : origin + "/" + v.replace(/^\.\//, "")
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
function unique(values: string[]): string[] { return values.filter((value, index) => !!value && values.indexOf(value) === index) }
function makeSource(url: string, quality: string): VideoSource {
    return { url, type: /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4", quality, subtitles: [] }
}

function decode64(value: string): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    const input = value.replace(/[^A-Za-z0-9+/=]/g, "")
    let output = "", buffer = 0, bits = 0
    for (const char of input) {
        if (char === "=") break
        const index = alphabet.indexOf(char)
        if (index < 0) continue
        buffer = (buffer << 6) | index
        bits += 6
        if (bits >= 8) { bits -= 8; output += String.fromCharCode((buffer >> bits) & 255) }
    }
    return output
}

function cookieHeader(response: Response): string {
    const h = response.headers as Headers & { getSetCookie?: () => string[] }
    let values = typeof h.getSetCookie === "function" ? h.getSetCookie() : []
    if (!values.length) {
        const raw = response.headers.get("set-cookie") || ""
        if (raw) values = raw.split(/,\s*(?=[^;,\s]+=)/)
    }
    return values.map(value => value.split(";")[0]).filter(Boolean).join("; ")
}

function language(value: number | string | undefined): string {
    const code = Number(value)
    return code === 1 ? "[JAP]" : code === 3 ? "[LAT]" : code === 4 ? "[CHIN]" : ""
}

function classify(candidate: Candidate): string {
    const value = `${candidate.server} ${candidate.url}`.toLowerCase()
    if (value.includes("umv?") || value.includes("magi")) return "Magi"
    if (value.includes("um.php") || value.includes("jkplayer/um?")) return "Desu"
    if (value.includes("um2.php") || value.includes("jkplayer/um2") || value.includes("nozomi")) return "Nozomi"
    if (value.includes("ok.ru") || value.includes("okru")) return "Okru"
    if (value.includes("stream/jkmedia")) return "Desuka"
    if (value.includes("streamtape") || value.includes("stape")) return "StreamTape"
    return candidate.server || "Mirror"
}

function collectMedia(html: string, base: string): string[] {
    const values: string[] = []
    const patterns = [
        /https?:\\?\/\\?\/[^'"\s<>]+?\.(?:m3u8|mp4)(?:\?[^'"\s<>]*)?/gi,
        /(?:file|source|src|url)\s*[:=]\s*['"]([^'"]+\.(?:m3u8|mp4)(?:\?[^'"]*)?)['"]/gi,
        /<(?:video|source)[^>]+src=['"]([^'"]+)['"]/gi,
    ]
    for (const pattern of patterns) {
        let match: RegExpExecArray | null
        while ((match = pattern.exec(html)) !== null) {
            const raw = match[1] || match[0]
            const url = absolute(raw.replace(/^['"]|['"]$/g, ""), base)
            if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(url)) values.push(url)
        }
    }
    return unique(values)
}

async function extractOkru(url: string, label: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: headers(url) })
    const $ = LoadDoc(await response.text())
    const raw = String($("[data-module='OKVideo']").first().attr("data-options") || "")
    if (!raw) return []
    try {
        const decoded = String(LoadDoc(`<textarea>${raw}</textarea>`)("textarea").text() || raw)
        const options = JSON.parse(decoded) as { flashvars?: { metadata?: string | Record<string, unknown> } }
        const value = options.flashvars?.metadata
        const metadata = typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value || {}
        const urls: string[] = []
        if (typeof metadata.hlsManifestUrl === "string") urls.push(metadata.hlsManifestUrl)
        if (Array.isArray(metadata.videos)) for (const item of metadata.videos as Array<{ url?: string }>) if (item.url) urls.push(item.url)
        return unique(urls).map(item => makeSource(item, label))
    } catch (_) { return [] }
}

async function extractStreamTape(url: string, label: string): Promise<VideoSource[]> {
    const id = url.split("/").filter(Boolean).pop()?.split("?")[0] || ""
    const embed = id ? `https://streamtape.com/e/${id}` : url
    const response = await fetch(embed, { headers: headers(embed) })
    const html = await response.text()
    const match = html.match(/robotlink['"]?\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('xcd([^']+)'/i)
        || html.match(/robotlink['"]?\)\.innerHTML\s*=\s*"([^"]+)"\s*\+\s*\("xcd([^"]+)"/i)
    const urls = collectMedia(html, response.url || embed)
    if (match) urls.unshift(`https:${match[1]}${match[2]}`)
    return unique(urls).map(item => makeSource(item, label))
}

async function extractNozomi(url: string, label: string): Promise<VideoSource[]> {
    const first = await fetch(url, { headers: headers(url) })
    const $ = LoadDoc(await first.text())
    const key = String($("form input[value]").first().attr("value") || "")
    if (!key) return []
    const redirect = await fetch(`${BASE}/gsplay/redirect_post.php`, {
        method: "POST", redirect: "follow", headers: { ...headers(url), "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(key)}`,
    })
    const postKey = (redirect.url || "").split("player.html#")[1] || ""
    if (!postKey) return []
    const api = await fetch(`${BASE}/gsplay/api.php`, {
        method: "POST", headers: { ...headers(url), "Content-Type": "application/x-www-form-urlencoded" },
        body: `v=${encodeURIComponent(postKey)}`,
    })
    const data = await api.json() as { file?: string }
    return data.file ? [makeSource(data.file, label)] : []
}

async function extractGeneric(url: string, label: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: headers(url) })
    const finalUrl = response.url || url
    const contentType = response.headers.get("content-type") || ""
    if (contentType.startsWith("video/") || /\.(?:m3u8|mp4)(?:$|[?#])/i.test(finalUrl)) return [makeSource(finalUrl, label)]
    return collectMedia(await response.text(), finalUrl).map(item => makeSource(item, label))
}

async function resolveCandidate(candidate: Candidate): Promise<EpisodeServer | null> {
    const kind = classify(candidate)
    const label = `${candidate.language} ${kind}`.trim()
    let sources: VideoSource[] = []
    if (kind === "Okru") sources = await extractOkru(candidate.url, label)
    else if (kind === "Nozomi") sources = await extractNozomi(candidate.url, label)
    else if (kind === "StreamTape") sources = await extractStreamTape(candidate.url, label)
    else sources = await extractGeneric(candidate.url, label)
    return sources.length ? { server: label, headers: headers(candidate.url), videoSources: sources } : null
}

function firstSuccessful(tasks: Array<() => Promise<EpisodeServer | null>>): Promise<EpisodeServer | null> {
    return new Promise(resolve => {
        if (!tasks.length) return resolve(null)
        let pending = tasks.length
        let settled = false
        for (const task of tasks) {
            task().then(result => {
                if (result && !settled) { settled = true; resolve(result); return }
                pending--
                if (!pending && !settled) resolve(null)
            }).catch(() => {
                pending--
                if (!pending && !settled) resolve(null)
            })
        }
    })
}

class Provider {
    getSettings(): Settings {
        return { episodeServers: ["Auto"], supportsDub: true }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const query = opts.query.trim().replace(/\s+/g, "_")
        if (!query) return []
        const response = await fetch(`${BASE}/buscar/${encodeURIComponent(query)}`, { headers: headers(`${BASE}/`) })
        if (!response.ok) return []
        const html = await response.text()
        const $ = LoadDoc(html)
        const output: SearchResult[] = []
        $("div.row div.row.page_directorio div.anime__item").each((_: number, element: unknown) => {
            const item = $(element), anchor = item.find("div.anime__item__text a").first()
            const title = String(anchor.text() || "").trim(), href = String(anchor.attr("href") || "")
            const url = absolute(href, BASE), id = url.replace(BASE, "").replace(/^\/+|\/+$/g, "")
            if (title && id) output.push({ id, title, url, subOrDub: "both" })
        })
        if (!output.length && $("div.anime__details__content").length) {
            const title = String($("div.anime__details__content div.anime_info h3").first().text() || "").trim()
            const id = (response.url || "").replace(BASE, "").replace(/^\/+|\/+$/g, "")
            if (title && id) output.push({ id, title, url: response.url, subOrDub: "both" })
        }
        return output
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const slug = id.replace(BASE, "").replace(/^\/+|\/+$/g, "")
        const animeUrl = `${BASE}/${slug}`
        const response = await fetch(animeUrl, { headers: headers(`${BASE}/`) })
        if (!response.ok) return []
        const html = await response.text(), $ = LoadDoc(html), output: EpisodeDetails[] = []
        const embedded = html.match(/var\s+episodes\s*=\s*(\[\[[\s\S]*?\]\])\s*;/)?.[1]
        if (embedded) {
            try {
                for (const row of JSON.parse(embedded) as unknown[][]) {
                    const number = Number(row[0])
                    if (Number.isFinite(number)) output.push({ id: `${slug}/${number}`, number, title: `Episodio ${number}`, url: `${animeUrl}/${number}` })
                }
            } catch (_) {}
        }
        if (!output.length) {
            const token = String($("meta[name='csrf-token']").first().attr("content") || "")
            const animeId = String($("#guardar-anime").first().attr("data-anime") || "")
            if (token && animeId) {
                const cookie = cookieHeader(response)
                const ajax = await fetch(`${BASE}/ajax/episodes/${animeId}/1`, {
                    method: "POST",
                    headers: { ...headers(animeUrl), "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", ...(cookie ? { Cookie: cookie } : {}) },
                    body: `_token=${encodeURIComponent(token)}`,
                })
                if (ajax.ok) {
                    const page = await ajax.json() as EpisodesPage
                    for (const ep of page.data || []) {
                        const number = Number(ep.number)
                        if (Number.isFinite(number)) output.push({ id: `${slug}/${number}`, number, title: ep.title || `Episodio ${number}`, url: `${animeUrl}/${number}` })
                    }
                    const from = Number(page.from || 1), to = Number(page.to || output.length), total = Number(page.total || output.length)
                    for (let number = to + 1; number <= from + total - 1; number++) output.push({ id: `${slug}/${number}`, number, title: `Episodio ${number}`, url: `${animeUrl}/${number}` })
                }
            }
        }
        const deduped: Record<string, EpisodeDetails> = {}
        for (const ep of output) deduped[String(ep.number)] = ep
        return Object.values(deduped).sort((a, b) => a.number - b.number)
    }

    private async candidates(episodeUrl: string): Promise<Candidate[]> {
        const response = await fetch(episodeUrl, { headers: headers(`${BASE}/`) })
        if (!response.ok) return []
        const html = await response.text(), $ = LoadDoc(html)
        let scripts = ""
        $("script").each((_: number, element: unknown) => { scripts += `\n${String($(element).html() || $(element).text() || "")}` })
        const output: Candidate[] = []
        const remote = scripts.match(/var\s+remote\s*=\s*['"]([^'"]+)['"]/i)?.[1] || ""
        const path = scripts.match(/=\s*remote\s*\+\s*['"]([^'"]+)['"]/i)?.[1] || ""
        let jsonText = scripts.match(/var\s+servers\s*=\s*(\[[\s\S]*?\])\s*;/i)?.[1] || ""
        if (remote && path) {
            const remoteResponse = await fetch(absolute(path, remote), { headers: headers(episodeUrl) })
            if (remoteResponse.ok) jsonText = await remoteResponse.text()
        }
        if (jsonText) {
            try {
                for (const link of JSON.parse(jsonText) as Array<{ remote?: string; server?: string; lang?: number }>) {
                    const decoded = link.remote ? decode64(link.remote) : ""
                    if (decoded) output.push({ url: absolute(decoded, episodeUrl), server: link.server || "Mirror", language: language(link.lang) })
                }
            } catch (_) {}
        }
        $("div.bg-servers a").each((_: number, element: unknown) => {
            const item = $(element)
            const id = String(item.attr("data-id") || "")
            if (!id) return
            const found = scripts.match(new RegExp(`video\\[\\s*${escapeRegex(id)}\\s*\\]\\s*=\\s*['\"][\\s\\S]*?src=['\"]([^'\"]+)`, "i"))?.[1] || ""
            if (!found) return
            const normalized = found
                .replace("/jkokru.php?u=", "https://ok.ru/videoembed/")
                .replace("/jkvmixdrop.php?u=", "https://mixdrop.ag/e/")
                .replace("/jksw.php?u=", "https://sfastwish.com/e/")
                .replace("/jk.php?u=", `${BASE}/`)
            const langCode = String(item.attr("class") || "").match(/lg_(\d+)/)?.[1]
            output.push({ url: absolute(normalized, episodeUrl), server: String(item.text() || "Mirror").trim(), language: language(langCode) })
        })
        const seen: Record<string, boolean> = {}
        return output.filter(candidate => {
            const key = `${candidate.url}|${candidate.language}`
            if (!candidate.url || seen[key]) return false
            seen[key] = true
            return true
        })
    }

    async findEpisodeServer(episode: EpisodeDetails, _server: string): Promise<EpisodeServer> {
        const candidates = await this.candidates(episode.url)
        const order = ["Desu", "Magi", "Nozomi", "Okru", "StreamTape", "Desuka"]
        candidates.sort((a, b) => {
            const ai = order.indexOf(classify(a)), bi = order.indexOf(classify(b))
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
        })
        const result = await firstSuccessful(candidates.slice(0, 6).map(candidate => () => resolveCandidate(candidate)))
        if (!result) throw new Error(`JKAnime no pudo resolver ${candidates.length} mirrors.`)
        return result
    }
}
