export interface MatchedImage {
  id: string
  path: string
  name: string
  matchedWords: string[]
  thumbnailUrl?: string
  selected: boolean
}

export interface SensitiveWord {
  id: string
  word: string
  created_at: string
}
