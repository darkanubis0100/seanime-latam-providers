/// <reference path="./online-streaming-provider.d.ts" />

type FlvEntry = { server?: string; title?: string; code?: string; url?: string }

const BASE = "https://www4.animeflv.net"
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

function unique(values: string[]): string[] {
    return values.filter((value, index) => !!value && values.indexOf(value) === index)
}

function makeSource(url: string, quality: string): VideoSource {
    return { url, type: /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4", quality, subtitles: [] }
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

async function extractOkru(url: string): Promise<VideoSource[]> {
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
        if (Array.isArray(metadata.videos)) {
            for (const item of metadata.videos as Array<{ url?: string }>) if (item.url) urls.push(item.url)
        }
        return unique(urls).map(item => makeSource(item, "Okru"))
    } catch (_) { return [] }
}

async function extractStreamTape(url: string): Promise<VideoSource[]> {
    const id = url.split("/").filter(Boolean).pop()?.split("?")[0] || ""
    const embed = id ? `https://streamtape.com/e/${id}` : url
    const response = await fetch(embed, { headers: headers(embed) })
    const html = await response.text()
    const match = html.match(/robotlink['"]?\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('xcd([^']+)'/i)
        || html.match(/robotlink['"]?\)\.innerHTML\s*=\s*"([^"]+)"\s*\+\s*\("xcd([^"]+)"/i)
    const urls = collectMedia(html, response.url || embed)
    if (match) urls.unshift(`https:${match[1]}${match[2]}`)
    return unique(urls).map(item => makeSource(item, "StreamTape"))
}

async function extractGeneric(url: string, label: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: headers(url) })
    const finalUrl = response.url || url
    const contentType = response.headers.get("content-type") || ""
    if (contentType.startsWith("video/") || /\.(?:m3u8|mp4)(?:$|[?#])/i.test(finalUrl)) return [makeSource(finalUrl, label)]
    return collectMedia(await response.text(), finalUrl).map(item => makeSource(item, label))
}

async function resolveEntry(entry: FlvEntry, episodeUrl: string): Promise<EpisodeServer | null> {
    const raw = entry.code || entry.url || ""
    if (!raw) return null
    const url = absolute(raw, episodeUrl)
    const identity = `${entry.title || ""} ${entry.server || ""} ${url}`.toLowerCase()
    const label = entry.title === "Stape" ? "StreamTape" : entry.title === "SW" ? "StreamWish" : entry.title || entry.server || "Mirror"
    let sources: VideoSource[] = []
    if (identity.includes("okru") || identity.includes("ok.ru")) sources = await extractOkru(url)
    else if (identity.includes("streamtape") || identity.includes("stape")) sources = await extractStreamTape(url)
    else sources = await extractGeneric(url, label)
    return sources.length ? { server: label, headers: headers(url), videoSources: sources } : null
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
        return { episodeServers: ["Auto"], supportsDub: false }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        if (opts.dub || !opts.query.trim()) return []
        const response = await fetch(`${BASE}/browse?q=${encodeURIComponent(opts.query)}`, { headers: headers(`${BASE}/`) })
        if (!response.ok) return []
        const $ = LoadDoc(await response.text())
        const results: SearchResult[] = []
        $("div.Container ul.ListAnimes li article").each((_: number, element: unknown) => {
            const item = $(element)
            const title = String(item.find("a h3").first().text() || "").trim()
            const href = String(item.find("div.Description a.Button").first().attr("href") || item.find("a").first().attr("href") || "")
            const url = absolute(href, BASE)
            const id = url.split("/anime/")[1]?.replace(/\/$/, "") || ""
            if (title && id) results.push({ id, title, url, subOrDub: "sub" })
        })
        return results
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const slug = id.split("/anime/").pop()?.replace(/^\/+|\/+$/g, "") || id
        const response = await fetch(`${BASE}/anime/${slug}`, { headers: headers(`${BASE}/`) })
        if (!response.ok) return []
        const html = await response.text()
        const animeInfo = html.match(/var\s+anime_info\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1]
        const episodesText = html.match(/var\s+episodes\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1]
        if (!episodesText) return []
        try {
            const info = animeInfo ? JSON.parse(animeInfo) as unknown[] : []
            const animeUri = typeof info[2] === "string" ? info[2] : slug
            return (JSON.parse(episodesText) as unknown[][])
                .map(row => Number(row[0])).filter(Number.isFinite)
                .map(number => ({ id: `${animeUri}-${number}`, number, title: `Episodio ${number}`, url: `${BASE}/ver/${animeUri}-${number}` }))
                .sort((a, b) => a.number - b.number)
        } catch (_) { return [] }
    }

    async findEpisodeServer(episode: EpisodeDetails, _server: string): Promise<EpisodeServer> {
        const response = await fetch(episode.url, { headers: headers(`${BASE}/`) })
        if (!response.ok) throw new Error(`AnimeFLV HTTP ${response.status}`)
        const jsonText = (await response.text()).match(/var\s+videos\s*=\s*(\{[\s\S]*?\})\s*;/)?.[1]
        if (!jsonText) throw new Error("AnimeFLV no entregó reproductores.")
        const data = JSON.parse(jsonText) as Record<string, FlvEntry[]>
        const entries = (data.SUB || data.sub || Object.values(data)[0] || []).filter(Boolean)
        const order = ["stape", "okru", "yourupload", "sw"]
        entries.sort((a, b) => {
            const av = `${a.title || ""} ${a.server || ""}`.toLowerCase()
            const bv = `${b.title || ""} ${b.server || ""}`.toLowerCase()
            const ai = order.findIndex(v => av.includes(v)), bi = order.findIndex(v => bv.includes(v))
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
        })
        const result = await firstSuccessful(entries.slice(0, 4).map(entry => () => resolveEntry(entry, episode.url)))
        if (!result) throw new Error(`AnimeFLV no pudo resolver ${entries.length} mirrors.`)
        return result
    }
}
