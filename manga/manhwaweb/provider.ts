/// <reference path="./manga-provider.d.ts" />

type ManhwaWebItem = {
    _id?: string
    real_id?: string
    the_real_name?: string
    _imagen?: string
}

type ManhwaWebChapter = {
    chapter?: string | number
    link?: string
}

class Provider {
    private webUrl = "https://manhwaweb.com"
    private api = "https://manhwawebbackend-production.up.railway.app"

    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        }
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const url = `${this.api}/manhwa/library?buscar=${encodeURIComponent(opts.query)}&estado=&tipo=&erotico=&demografia=&order_item=alfabetico&order_dir=desc&page=0&generes=`
        const response = await fetch(url)
        if (!response.ok) return []
        const json = await response.json() as { data?: ManhwaWebItem[] }
        return (json.data || []).map((item) => ({
            id: `${item._id || ""}::${item.real_id || ""}`,
            title: item.the_real_name || item.real_id || "Sin título",
            synonyms: item.real_id ? [item.real_id] : [],
            image: item._imagen || "",
        }))
    }

    async findChapters(mangaId: string): Promise<ChapterDetails[]> {
        const candidates = mangaId.split("::").filter(Boolean)
        let selected = ""
        let payload: { _id?: string; real_id?: string; chapters?: ManhwaWebChapter[] } | null = null

        for (const candidate of candidates) {
            const response = await fetch(`${this.api}/manhwa/see/${encodeURIComponent(candidate)}`)
            if (!response.ok) continue
            const json = await response.json() as { _id?: string; real_id?: string; chapters?: ManhwaWebChapter[] }
            if (Array.isArray(json.chapters)) {
                selected = candidate
                payload = json
                break
            }
        }
        if (!payload?.chapters) return []

        const slug = payload.real_id || payload._id || selected
        const chapters = payload.chapters.map((item, index) => {
            const number = String(item.chapter ?? index + 1)
            const chapterId = `${slug}-${number}`
            return {
                id: chapterId,
                url: item.link || `${this.webUrl}/leer/${chapterId}`,
                title: `Capítulo ${number}`,
                chapter: number,
                index,
                language: "es",
            }
        })

        chapters.sort((a, b) => {
            const aNumber = Number.parseFloat(a.chapter)
            const bNumber = Number.parseFloat(b.chapter)
            if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber
            return a.chapter.localeCompare(b.chapter)
        })
        chapters.forEach((chapter, index) => { chapter.index = index })
        return chapters
    }

    async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
        const response = await fetch(`${this.api}/chapters/see/${encodeURIComponent(chapterId)}`)
        if (!response.ok) return []
        const json = await response.json() as { chapter?: { img?: string[] } }
        return (json.chapter?.img || []).filter(Boolean).map((url, index) => ({
            url,
            index,
            headers: {
                "Referer": `${this.webUrl}/`,
            },
        }))
    }
}
