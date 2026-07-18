declare type SearchResult = {
    id: string
    title: string
    url: string
    subOrDub: "sub" | "dub" | "both"
}

declare type EpisodeDetails = {
    id: string
    number: number
    url: string
    title?: string
}

declare type VideoSubtitle = {
    id: string
    url: string
    language: string
    isDefault: boolean
}

declare type VideoSource = {
    url: string
    type: "mp4" | "m3u8"
    quality: string
    subtitles: VideoSubtitle[]
}

declare type EpisodeServer = {
    server: string
    headers: { [key: string]: string }
    videoSources: VideoSource[]
}

declare interface Media {
    id: number
    idMal?: number
    status?: string
    format?: string
    englishTitle?: string
    romajiTitle?: string
    episodeCount?: number
    absoluteSeasonOffset?: number
    synonyms: string[]
    isAdult: boolean
    startDate?: { year: number; month?: number; day?: number }
}

declare type SearchOptions = {
    media: Media
    query: string
    dub: boolean
    year?: number
}

declare type Settings = {
    episodeServers: string[]
    supportsDub: boolean
}

declare function LoadDoc(html: string): any
