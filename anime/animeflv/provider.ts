/// <reference path="./online-streaming-provider.d.ts" />

type FlvServerEntry = {
    server?: string
    title?: string
    code?: string
    url?: string
}

const FLV_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

function flvHeaders(referer: string): Record<string, string> {
    return {
        "User-Agent": FLV_UA,
        "Referer": referer,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
}

function flvAbsoluteUrl(value: string, base: string): string {
    const cleaned = value.trim().replace(/\\\//g, "/").replace(/&amp;/g, "&")
    if (!cleaned) return ""
    if (cleaned.startsWith("//")) return `https:${cleaned}`
    try { return new URL(cleaned, base).toString() } catch (_) { return cleaned }
}

function flvVideoType(url: string): "mp4" | "m3u8" {
    return /\.m3u8(?:$|[?#])/i.test(url) ? "m3u8" : "mp4"
}

function flvQuality(url: string, fallback: string): string {
    const match = url.match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/i)
    return match ? `${fallback} ${match[1]}p` : fallback
}

function flvUnique(values: string[]): string[] {
    const seen: Record<string, boolean> = {}
    const output: string[] = []
    for (const value of values) {
        const key = value.trim()
        if (!key || seen[key]) continue
        seen[key] = true
        output.push(key)
    }
    return output
}

function flvEscapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function flvDecodeJsString(value: string, quote: string): string {
    try {
        return Function(`"use strict"; return ${quote}${value}${quote};`)() as string
    } catch (_) {
        return value.replace(/\\\//g, "/").replace(/\\'/g, "'").replace(/\\"/g, '"')
    }
}

function flvBaseToken(value: number, radix: number): string {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if (value === 0) return "0"
    let number = value
    let result = ""
    const safeRadix = Math.max(2, Math.min(radix, alphabet.length))
    while (number > 0) {
        result = alphabet[number % safeRadix] + result
        number = Math.floor(number / safeRadix)
    }
    return result
}

function flvUnpackPacker(source: string): string[] {
    const unpacked: string[] = []
    const patterns = [
        /eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/g,
        /eval\(function\(p,a,c,k,e,[rd]\)\{[\s\S]*?\}\(\s*"([\s\S]*?)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([\s\S]*?)"\.split\("\|"\)/g,
    ]

    for (let p = 0; p < patterns.length; p++) {
        const regex = patterns[p]
        let match: RegExpExecArray | null
        while ((match = regex.exec(source)) !== null) {
            const quote = p === 0 ? "'" : '"'
            let payload = flvDecodeJsString(match[1], quote)
            const radix = Number(match[2])
            const count = Number(match[3])
            const symbols = flvDecodeJsString(match[4], quote).split("|")
            for (let i = count - 1; i >= 0; i--) {
                if (!symbols[i]) continue
                const token = flvBaseToken(i, radix)
                payload = payload.replace(new RegExp(`\\b${flvEscapeRegExp(token)}\\b`, "g"), symbols[i])
            }
            unpacked.push(payload)
        }
    }
    return unpacked
}

function flvCollectMediaUrls(text: string, base: string): string[] {
    const values: string[] = []
    const patterns = [
        /https?:\\?\/\\?\/[^'"\s<>]+?\.(?:m3u8|mp4)(?:\?[^'"\s<>]*)?/gi,
        /(?:file|source|src|url)\s*[:=]\s*['"]([^'"]+\.(?:m3u8|mp4)(?:\?[^'"]*)?)['"]/gi,
        /<source[^>]+src=['"]([^'"]+)['"]/gi,
        /<video[^>]+src=['"]([^'"]+)['"]/gi,
    ]

    for (let i = 0; i < patterns.length; i++) {
        const regex = patterns[i]
        let match: RegExpExecArray | null
        while ((match = regex.exec(text)) !== null) {
            const raw = match[1] || match[0]
            const normalized = flvAbsoluteUrl(raw.replace(/^['"]|['"]$/g, ""), base)
            if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(normalized)) values.push(normalized)
        }
    }
    return flvUnique(values)
}

function flvAtob(value: string): string {
    try { return atob(value) } catch (_) { return "" }
}

function flvRot13(input: string): string {
    return input.replace(/[A-Za-z]/g, (character) => {
        const code = character.charCodeAt(0)
        const base = code <= 90 ? 65 : 97
        return String.fromCharCode(((code - base + 13) % 26) + base)
    })
}

async function flvExtractVoe(url: string, label: string): Promise<VideoSource[]> {
    let response = await fetch(url, { headers: flvHeaders(url) })
    let html = await response.text()
    const redirect = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i)
    if (redirect) {
        const redirected = flvAbsoluteUrl(redirect[1], response.url || url)
        response = await fetch(redirected, { headers: flvHeaders(url) })
        html = await response.text()
    }

    const $ = LoadDoc(html)
    let encoded = String($("script[type='application/json']").first().text() || "").trim()
    if (!encoded) encoded = String($("script[type='application/json']").first().html() || "").trim()
    encoded = encoded.replace(/^\[\s*"/, "").replace(/"\s*\]$/, "")
    if (!encoded) return []

    try {
        const replaced = flvRot13(encoded).replace(/@\$|\^\^|~@|%\?|\*~|!!|#&/g, "_").replace(/_/g, "")
        const first = flvAtob(replaced)
        if (!first) return []
        let shifted = ""
        for (let i = 0; i < first.length; i++) shifted += String.fromCharCode(first.charCodeAt(i) - 3)
        const decoded = flvAtob(shifted.split("").reverse().join(""))
        const data = JSON.parse(decoded) as { source?: string; direct_access_url?: string }
        const urls = flvUnique([data.source || "", data.direct_access_url || ""])
        return urls.map((item) => ({
            url: item,
            type: flvVideoType(item),
            quality: flvQuality(item, label),
            subtitles: [],
        }))
    } catch (_) {
        return []
    }
}

async function flvExtractOkru(url: string, label: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: flvHeaders(url) })
    const html = await response.text()
    const $ = LoadDoc(html)
    const element = $("[data-module='OKVideo']").first()
    const rawOptions = String(element.attr("data-options") || "")
    if (!rawOptions) return []

    try {
        const textarea = LoadDoc(`<textarea>${rawOptions}</textarea>`)
        const decodedOptions = String(textarea("textarea").text() || rawOptions)
        const options = JSON.parse(decodedOptions) as { flashvars?: { metadata?: string | Record<string, unknown> } }
        const metadataValue = options.flashvars?.metadata
        const metadata = typeof metadataValue === "string" ? JSON.parse(metadataValue) as Record<string, unknown> : metadataValue || {}
        const urls: string[] = []
        if (typeof metadata.hlsManifestUrl === "string") urls.push(metadata.hlsManifestUrl)
        if (Array.isArray(metadata.videos)) {
            for (const video of metadata.videos as Array<{ url?: string }>) {
                if (video.url) urls.push(video.url)
            }
        }
        return flvUnique(urls).map((item) => ({
            url: item,
            type: flvVideoType(item),
            quality: flvQuality(item, label),
            subtitles: [],
        }))
    } catch (_) {
        return []
    }
}

async function flvExtractStreamTape(url: string, label: string): Promise<VideoSource[]> {
    const parts = url.split("/").filter(Boolean)
    const id = parts.length > 0 ? parts[parts.length - 1].split("?")[0] : ""
    const embed = id ? `https://streamtape.com/e/${id}` : url
    const response = await fetch(embed, { headers: flvHeaders(embed) })
    const html = await response.text()
    const match = html.match(/robotlink['"]?\)\.innerHTML\s*=\s*'([^']+)'\s*\+\s*\('xcd([^']+)'/i)
        || html.match(/robotlink['"]?\)\.innerHTML\s*=\s*"([^"]+)"\s*\+\s*\("xcd([^"]+)"/i)
    const urls: string[] = []
    if (match) urls.push(flvAbsoluteUrl(`https:${match[1]}${match[2]}`, embed))
    urls.push(...flvCollectMediaUrls(html, response.url || embed))
    return flvUnique(urls).map((item) => ({
        url: item,
        type: flvVideoType(item),
        quality: flvQuality(item, label),
        subtitles: [],
    }))
}

async function flvExtractDood(url: string, label: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: flvHeaders(url) })
    const html = await response.text()
    const pass = html.match(/['"](\/pass_md5\/[^'"]+)['"]/)
    if (!pass) return []
    const passUrl = flvAbsoluteUrl(pass[1], response.url || url)
    const token = html.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1] || html.match(/token\s*=\s*['"]([^'"]+)/)?.[1] || ""
    const expiry = html.match(/expiry\s*=\s*['"]?(\d+)/)?.[1] || String(Date.now())
    const passResponse = await fetch(passUrl, { headers: flvHeaders(response.url || url) })
    const baseVideo = (await passResponse.text()).trim()
    if (!baseVideo.startsWith("http")) return []
    const random = Math.random().toString(36).slice(2, 12)
    const separator = baseVideo.includes("?") ? "&" : "?"
    const finalUrl = `${baseVideo}${random}${separator}token=${encodeURIComponent(token)}&expiry=${encodeURIComponent(expiry)}`
    return [{ url: finalUrl, type: "mp4", quality: label, subtitles: [] }]
}

async function flvExtractGeneric(url: string, label: string, referer: string): Promise<VideoSource[]> {
    const response = await fetch(url, { headers: flvHeaders(referer) })
    const contentType = response.headers.get("content-type") || ""
    if (contentType.startsWith("video/") || /\.(?:m3u8|mp4)(?:$|[?#])/i.test(response.url)) {
        return [{
            url: response.url || url,
            type: flvVideoType(response.url || url),
            quality: flvQuality(response.url || url, label),
            subtitles: [],
        }]
    }

    const html = await response.text()
    const bodies = [html].concat(flvUnpackPacker(html))
    const urls: string[] = []
    for (const body of bodies) urls.push(...flvCollectMediaUrls(body, response.url || url))
    return flvUnique(urls).map((item) => ({
        url: item,
        type: flvVideoType(item),
        quality: flvQuality(item, label),
        subtitles: [],
    }))
}

async function flvExtract(url: string, label: string, referer: string): Promise<VideoSource[]> {
    const lower = url.toLowerCase()
    if (lower.includes("streamtape") || lower.includes("stape") || lower.includes("shavetape")) {
        return flvExtractStreamTape(url, label)
    }
    if (lower.includes("ok.ru") || lower.includes("okru")) return flvExtractOkru(url, label)
    if (lower.includes("voe") || lower.includes("tubelessceliolymph") || lower.includes("simpulumlamerop")) {
        return flvExtractVoe(url, label)
    }
    if (lower.includes("dood") || lower.includes("d-s.io") || lower.includes("dsvplay")) {
        return flvExtractDood(url, label)
    }
    return flvExtractGeneric(url, label, referer)
}

class Provider {
    api = "https://www4.animeflv.net"

    getSettings(): Settings {
        return {
            episodeServers: ["Auto", "StreamWish", "YourUpload", "Okru", "StreamTape"],
            supportsDub: false,
        }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        if (opts.dub) return []
        const response = await fetch(`${this.api}/browse?q=${encodeURIComponent(opts.query)}`, {
            headers: flvHeaders(`${this.api}/`),
        })
        if (!response.ok) return []
        const html = await response.text()
        const $ = LoadDoc(html)
        const results: SearchResult[] = []

        $("div.Container ul.ListAnimes li article").each((_: number, element: unknown) => {
            const item = $(element)
            const title = String(item.find("a h3").first().text() || "").trim()
            const href = String(item.find("div.Description a.Button").first().attr("href") || item.find("a").first().attr("href") || "")
            const url = flvAbsoluteUrl(href, this.api)
            const id = url.split("/anime/")[1]?.replace(/\/$/, "") || href.split("/").filter(Boolean).pop() || ""
            if (!title || !id) return
            results.push({ id, title, url, subOrDub: "sub" })
        })
        return results
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const slug = id.includes("/") ? id.split("/anime/").pop()?.replace(/\/$/, "") || id : id
        const pageUrl = `${this.api}/anime/${slug}`
        const response = await fetch(pageUrl, { headers: flvHeaders(`${this.api}/`) })
        if (!response.ok) return []
        const html = await response.text()
        const $ = LoadDoc(html)
        let scriptBody = ""
        $("script").each((_: number, element: unknown) => { scriptBody += `\n${String($(element).html() || $(element).text() || "")}` })

        const animeInfoMatch = scriptBody.match(/var\s+anime_info\s*=\s*(\[[\s\S]*?\])\s*;/)
        const episodesMatch = scriptBody.match(/var\s+episodes\s*=\s*(\[[\s\S]*?\])\s*;/)
        const output: EpisodeDetails[] = []

        if (episodesMatch) {
            try {
                const animeInfo = animeInfoMatch ? JSON.parse(animeInfoMatch[1]) as unknown[] : []
                const animeUri = typeof animeInfo[2] === "string" ? animeInfo[2] : slug
                const episodes = JSON.parse(episodesMatch[1]) as unknown[][]
                for (const episode of episodes) {
                    const number = Number(episode[0])
                    if (!Number.isFinite(number)) continue
                    output.push({
                        id: `${animeUri}-${number}`,
                        number,
                        title: `Episodio ${number}`,
                        url: `${this.api}/ver/${animeUri}-${number}`,
                    })
                }
            } catch (_) {
                // DOM fallback below.
            }
        }

        if (output.length === 0) {
            $("a[href*='/ver/']").each((_: number, element: unknown) => {
                const href = String($(element).attr("href") || "")
                const match = href.match(/-(\d+(?:\.\d+)?)\/?$/)
                if (!match) return
                const number = Number(match[1])
                output.push({
                    id: href.split("/ver/").pop() || `${slug}-${number}`,
                    number,
                    title: `Episodio ${number}`,
                    url: flvAbsoluteUrl(href, this.api),
                })
            })
        }

        const byNumber: Record<string, EpisodeDetails> = {}
        for (const episode of output) byNumber[String(episode.number)] = episode
        return Object.keys(byNumber).map((key) => byNumber[key]).sort((a, b) => a.number - b.number)
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const response = await fetch(episode.url, { headers: flvHeaders(`${this.api}/`) })
        if (!response.ok) throw new Error(`AnimeFLV respondió HTTP ${response.status}`)
        const html = await response.text()
        const match = html.match(/var\s+videos\s*=\s*(\{[\s\S]*?\})\s*;/)
        if (!match) throw new Error("No se encontró la lista de reproductores de AnimeFLV.")

        const parsed = JSON.parse(match[1]) as Record<string, FlvServerEntry[]>
        const entries = (parsed.SUB || parsed.sub || Object.values(parsed)[0] || []).filter(Boolean)
        const normalizedServer = server.toLowerCase()
        const aliases: Record<string, string[]> = {
            streamwish: ["sw", "streamwish", "wish"],
            yourupload: ["yourupload", "yu"],
            okru: ["okru", "ok.ru"],
            streamtape: ["stape", "streamtape", "stape"],
        }

        let candidates = entries
        if (normalizedServer !== "auto") {
            const accepted = aliases[normalizedServer] || [normalizedServer]
            candidates = entries.filter((entry) => {
                const haystack = `${entry.title || ""} ${entry.server || ""} ${entry.code || entry.url || ""}`.toLowerCase()
                return accepted.some((alias) => haystack.includes(alias))
            })
        } else {
            const priority = ["sw", "yourupload", "okru", "stape"]
            candidates = entries.slice().sort((a, b) => {
                const aText = `${a.title || ""} ${a.server || ""}`.toLowerCase()
                const bText = `${b.title || ""} ${b.server || ""}`.toLowerCase()
                const aIndex = priority.findIndex((item) => aText.includes(item))
                const bIndex = priority.findIndex((item) => bText.includes(item))
                return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex)
            })
        }

        for (const entry of candidates) {
            const rawUrl = entry.code || entry.url || ""
            if (!rawUrl) continue
            const embedUrl = flvAbsoluteUrl(rawUrl, episode.url)
            const label = entry.title === "SW" ? "StreamWish" : entry.title === "Stape" ? "StreamTape" : entry.title || entry.server || server
            try {
                const sources = await flvExtract(embedUrl, label, episode.url)
                if (sources.length > 0) {
                    return {
                        server: label,
                        headers: flvHeaders(embedUrl),
                        videoSources: sources,
                    }
                }
            } catch (_) {
                // Try the next mirror.
            }
        }
        throw new Error(`No se pudo extraer un video para ${server}. Prueba otro servidor.`)
    }
}
