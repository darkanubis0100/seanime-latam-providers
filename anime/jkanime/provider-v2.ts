/// <reference path="./online-streaming-provider.d.ts" />

type Candidate = { url: string; server: string; language: string }
type EpisodesPage = { data?: Array<{ title?: string; number?: number }>; from?: number; to?: number; total?: number }

const BASE = "https://jkanime.net"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
const nativeFetch = fetch

function request(url: string, options: Record<string, unknown> = {}, timeout = 9): Promise<Response> {
    return nativeFetch(url, { ...options, timeout } as any)
}
function pageHeaders(referer: string): Record<string, string> {
    return { "User-Agent": UA, Referer: referer, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" }
}
function mediaHeaders(referer: string): Record<string, string> {
    return { "User-Agent": UA, Referer: referer, Accept: "*/*" }
}
function absolute(value: string, base: string): string {
    const v = value.trim().replace(/\\\//g, "/").replace(/&amp;/g, "&")
    if (!v) return ""
    if (/^https?:\/\//i.test(v)) return v
    if (v.startsWith("//")) return `https:${v}`
    const origin = base.match(/^(https?:\/\/[^/]+)/i)?.[1] || BASE
    if (v.startsWith("/")) return origin + v
    return origin + "/" + v.replace(/^\.\//, "")
}
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
function unique(values: string[]): string[] { return values.filter((value, index) => value && values.indexOf(value) === index) }
function source(url: string, quality: string): VideoSource {
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
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    let values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : []
    if (!values.length) {
        const raw = response.headers.get("set-cookie") || ""
        if (raw) values = raw.split(/,\s*(?=[^;,\s]+=)/)
    }
    return values.map((value) => value.split(";")[0]).filter(Boolean).join("; ")
}
function language(value: number | string | undefined): string {
    const code = Number(value)
    return code === 1 ? "[JAP]" : code === 3 ? "[LAT]" : code === 4 ? "[CHIN]" : ""
}
function classify(candidate: Candidate): string {
    const value = `${candidate.server} ${candidate.url}`.toLowerCase()
    if (value.includes("ok.ru") || value.includes("okru")) return "Okru"
    if (value.includes("um2.php") || value.includes("jkplayer/um2") || value.includes("nozomi")) return "Nozomi"
    if (value.includes("umv?") || value.includes("magi")) return "Magi"
    if (value.includes("um.php") || value.includes("jkplayer/um?")) return "Desu"
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
    for (const regex of patterns) {
        let match: RegExpExecArray | null
        while ((match = regex.exec(html)) !== null) {
            const raw = match[1] || match[0]
            const url = absolute(raw.replace(/^['"]|['"]$/g, ""), base)
            if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(url)) values.push(url)
        }
    }
    return unique(values)
}
async function extractOkru(url: string, label: string): Promise<VideoSource[]> {
    const response = await request(url, { headers: pageHeaders(url) }, 7)
    const $ = LoadDoc(await response.text())
    const raw = String($("[data-module='OKVideo']").first().attr("data-options") || "")
    if (!raw) return []
    try {
        const decoded = String(LoadDoc(`<textarea>${raw}</textarea>`)("textarea").text() || raw)
        const options = JSON.parse(decoded) as { flashvars?: { metadata?: string | Record<string, unknown> } }
        const metaValue = options.flashvars?.metadata
        const meta = typeof metaValue === "string" ? JSON.parse(metaValue) as Record<string, unknown> : metaValue || {}
        const urls: string[] = []
        if (typeof meta.hlsManifestUrl === "string") urls.push(meta.hlsManifestUrl)
        if (Array.isArray(meta.videos)) for (const item of meta.videos as Array<{ url?: string }>) if (item.url) urls.push(item.url)
        return unique(urls).map((item) => source(item, label))
    } catch (_) { return [] }
}
async function extractStreamTape(url: string, label: string): Promise<VideoSource[]> {
    const id = url.split("/").filter(Boolean).pop()?.split("?")[0] || ""
    const embed = id ? `https://streamtape.com/e/${id}` : url
    const response = await request(embed, { headers: pageHeaders(embed) }, 7)
    const html = await response.text()
    const match = html.match(/robotlink['"]?\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('xcd([^']+)'/i)
    const urls = collectMedia(html, response.url || embed)
    if (match) urls.unshift(`https:${match[1]}${match[2]}`)
    return unique(urls).map((item) => source(item, label))
}
async function extractNozomi(url: string, label: string): Promise<VideoSource[]> {
    const first = await request(url, { headers: pageHeaders(url) }, 7)
    const $ = LoadDoc(await first.text())
    const key = String($("form input[value]").first().attr("value") || "")
    if (!key) return []
    const redirect = await request(`${BASE}/gsplay/redirect_post.php`, {
        method: "POST", redirect: "follow", headers: { ...pageHeaders(url), "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(key)}`,
    }, 7)
    const postKey = (redirect.url || "").split("player.html#")[1] || ""
    if (!postKey) return []
    const api = await request(`${BASE}/gsplay/api.php`, {
        method: "POST", headers: { ...pageHeaders(url), "Content-Type": "application/x-www-form-urlencoded" },
        body: `v=${encodeURIComponent(postKey)}`,
    }, 7)
    const data = await api.json() as { file?: string }
    return data.file ? [source(data.file, label)] : []
}
async function extractGeneric(url: string, label: string): Promise<VideoSource[]> {
    const response = await request(url, { headers: pageHeaders(url) }, 7)
    const contentType = response.headers.get("content-type") || ""
    if (contentType.startsWith("video/") || /\.(?:m3u8|mp4)(?:$|[?#])/i.test(response.url || url)) return [source(response.url || url, label)]
    return collectMedia(await response.text(), response.url || url).map((item) => source(item, label))
}
async function extractCandidate(candidate: Candidate): Promise<EpisodeServer | null> {
    const kind = classify(candidate), label = `${candidate.language} ${kind}`.trim()
    let sources: VideoSource[] = []
    if (kind === "Okru") sources = await extractOkru(candidate.url, label)
    else if (kind === "Nozomi") sources = await extractNozomi(candidate.url, label)
    else if (kind === "StreamTape") sources = await extractStreamTape(candidate.url, label)
    else sources = await extractGeneric(candidate.url, label)
    return sources.length ? { server: label, headers: mediaHeaders(candidate.url), videoSources: sources } : null
}

class Provider {
    getSettings(): Settings {
        return { episodeServers: ["Auto", "Nozomi", "Okru", "Magi", "Desu", "Desuka", "StreamTape"], supportsDub: true }
    }
    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const query = opts.query.trim().replace(/\s+/g, "_")
        if (!query) return []
        const response = await request(`${BASE}/buscar/${encodeURIComponent(query)}`, { headers: pageHeaders(`${BASE}/`) }, 12)
        if (!response.ok) return []
        const html = await response.text(), $ = LoadDoc(html), output: SearchResult[] = []
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
        const slug = id.replace(BASE, "").replace(/^\/+|\/+$/g, ""), animeUrl = `${BASE}/${slug}`
        const response = await request(animeUrl, { headers: pageHeaders(`${BASE}/`) }, 12)
        if (!response.ok) return []
        const html = await response.text(), $ = LoadDoc(html), output: EpisodeDetails[] = []
        const embedded = html.match(/var\s+episodes\s*=\s*(\[\[[\s\S]*?\]\])\s*;/)?.[1]
        if (embedded) {
            try {
                for (const row of JSON.parse(embedded) as unknown[][]) {
                    const number = Number(row[0]); if (Number.isFinite(number)) output.push({ id: `${slug}/${number}`, number, title: `Episodio ${number}`, url: `${animeUrl}/${number}` })
                }
            } catch (_) {}
        }
        if (!output.length) {
            const token = String($("meta[name='csrf-token']").first().attr("content") || "")
            const animeId = String($("#guardar-anime").first().attr("data-anime") || "")
            if (token && animeId) {
                const cookie = cookieHeader(response)
                const ajax = await request(`${BASE}/ajax/episodes/${animeId}/1`, {
                    method: "POST", headers: { ...pageHeaders(animeUrl), "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", ...(cookie ? { Cookie: cookie } : {}) },
                    body: `_token=${encodeURIComponent(token)}`,
                }, 12)
                if (ajax.ok) {
                    const page = await ajax.json() as EpisodesPage
                    for (const ep of page.data || []) {
                        const number = Number(ep.number); if (Number.isFinite(number)) output.push({ id: `${slug}/${number}`, number, title: ep.title || `Episodio ${number}`, url: `${animeUrl}/${number}` })
                    }
                    const from = Number(page.from || 1), to = Number(page.to || output.length), total = Number(page.total || output.length)
                    for (let number = to + 1; number <= from + total - 1; number++) output.push({ id: `${slug}/${number}`, number, title: `Episodio ${number}`, url: `${animeUrl}/${number}` })
                }
            }
        }
        const deduped: Record<string, EpisodeDetails> = {}; for (const ep of output) deduped[String(ep.number)] = ep
        return Object.values(deduped).sort((a, b) => a.number - b.number)
    }
    private async candidates(episodeUrl: string): Promise<Candidate[]> {
        const response = await request(episodeUrl, { headers: pageHeaders(`${BASE}/`) }, 12)
        if (!response.ok) return []
        const html = await response.text(), $ = LoadDoc(html)
        let scripts = ""; $("script").each((_: number, element: unknown) => { scripts += `\n${String($(element).html() || $(element).text() || "")}` })
        const output: Candidate[] = []
        const remote = scripts.match(/var\s+remote\s*=\s*['"]([^'"]+)['"]/i)?.[1] || ""
        const path = scripts.match(/=\s*remote\s*\+\s*['"]([^'"]+)['"]/i)?.[1] || ""
        let jsonText = scripts.match(/var\s+servers\s*=\s*(\[[\s\S]*?\])\s*;/i)?.[1] || ""
        if (remote && path) {
            const remoteResponse = await request(absolute(path, remote), { headers: pageHeaders(episodeUrl) }, 8)
            if (remoteResponse.ok) jsonText = await remoteResponse.text()
        }
        if (jsonText) {
            try {
                for (const item of JSON.parse(jsonText) as Array<{ remote?: string; server?: string; lang?: number }>) {
                    const url = item.remote ? decode64(item.remote) : ""
                    if (url) output.push({ url: absolute(url, episodeUrl), server: item.server || "Mirror", language: language(item.lang) })
                }
            } catch (_) {}
        }
        $("div.bg-servers a").each((_: number, element: unknown) => {
            const item = $(element), id = String(item.attr("data-id") || "")
            if (!id) return
            const found = scripts.match(new RegExp(`video\\[\\s*${escapeRegex(id)}\\s*\\]\\s*=\\s*['"][\\s\\S]*?src=['"]([^'"]+)`, "i"))?.[1] || ""
            if (!found) return
            const normalized = found.replace("/jkokru.php?u=", "https://ok.ru/videoembed/").replace("/jkvmixdrop.php?u=", "https://mixdrop.ag/e/").replace("/jksw.php?u=", "https://sfastwish.com/e/").replace("/jk.php?u=", `${BASE}/`)
            const lang = String(item.attr("class") || "").match(/lg_(\d+)/)?.[1]
            output.push({ url: absolute(normalized, episodeUrl), server: String(item.text() || "Mirror").trim(), language: language(lang) })
        })
        return output.filter((item, index) => item.url && output.findIndex((other) => other.url === item.url && other.language === item.language) === index)
    }
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        let candidates = await this.candidates(episode.url)
        const requested = server.toLowerCase()
        if (requested !== "auto") candidates = candidates.filter((item) => classify(item).toLowerCase() === requested)
        else {
            const order = ["Nozomi", "Okru", "Magi", "Desu", "Desuka", "StreamTape"]
            candidates.sort((a, b) => {
                const ai = order.indexOf(classify(a)), bi = order.indexOf(classify(b))
                return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
            })
        }
        for (const candidate of candidates.slice(0, 6)) {
            try { const result = await extractCandidate(candidate); if (result) return result }
            catch (error) { console.warn(`[JKAnime] ${classify(candidate)}: ${String(error)}`) }
        }
        throw new Error(`JKAnime no pudo resolver el stream (${candidates.length} mirrors).`)
    }
}
