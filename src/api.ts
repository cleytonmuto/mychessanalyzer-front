export type MateMove = {
  san: string
  uci: string
  from_square: string
  to_square: string
}

export type Analysis = {
  id: number
  fen: string
  best_move_uci: string | null
  best_move_san: string | null
  from_square: string | null
  to_square: string | null
  score_type: string
  score_value: number | null
  evaluation_label: string
  depth: number
  mate_line: MateMove[] | null
  created_at: string
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
  }
  return fallback
}

export async function analyzePosition(fen: string): Promise<Analysis> {
  const response = await fetch(`${API_BASE}/api/analyses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Analysis failed.'))
  }
  return response.json() as Promise<Analysis>
}

export type PlayReply = {
  uci: string
  san: string
  from_square: string
  to_square: string
  evaluation_label: string
  score_type: string
  score_value: number | null
  depth: number
}

export type ReviewEval = {
  best_move_uci: string | null
  best_move_san: string | null
  score_type: string
  score_value: number | null
  depth: number
}

export async function reviewPosition(fen: string, depth: number): Promise<ReviewEval> {
  const response = await fetch(`${API_BASE}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, depth }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Stockfish could not review this position.'))
  }
  return response.json() as Promise<ReviewEval>
}

export async function requestEngineMove(fen: string, depth: number, sans: string[]): Promise<PlayReply> {
  const response = await fetch(`${API_BASE}/api/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, depth, sans }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Stockfish could not play a move.'))
  }
  return response.json() as Promise<PlayReply>
}

export async function listAnalyses(): Promise<Analysis[]> {
  const response = await fetch(`${API_BASE}/api/analyses`)
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Could not load recent analyses.'))
  }
  return response.json() as Promise<Analysis[]>
}

export type SavedGame = {
  id: number
  pgn: string
  white: string
  black: string
  result: string
  created_at: string
}

export type SavedPosition = {
  id: number
  fen: string
  created_at: string
}

export async function listPositions(): Promise<SavedPosition[]> {
  const response = await fetch(`${API_BASE}/api/positions`)
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Could not load saved positions.'))
  }
  return response.json() as Promise<SavedPosition[]>
}

export async function saveFen(fen: string): Promise<SavedPosition> {
  const response = await fetch(`${API_BASE}/api/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'The position could not be saved.'))
  }
  return response.json() as Promise<SavedPosition>
}

export async function listGames(): Promise<SavedGame[]> {
  const response = await fetch(`${API_BASE}/api/games`)
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Could not load saved games.'))
  }
  return response.json() as Promise<SavedGame[]>
}

export async function savePgn(pgn: string): Promise<SavedGame> {
  const response = await fetch(`${API_BASE}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pgn }),
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'The game could not be saved.'))
  }
  return response.json() as Promise<SavedGame>
}
