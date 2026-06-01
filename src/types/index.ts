export interface MatchedImage {
  id: string
  path: string
  name: string
  matchedWords: string[]
  thumbnailUrl?: string
}

export interface SensitiveWord {
  id: string
  word: string
  created_at: string
}
