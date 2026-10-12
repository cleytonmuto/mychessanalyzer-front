import { Chess, type PieceSymbol } from 'chess.js'
import type { Analysis, MateMove } from './api'
import { parseFen, type PieceCode, type Placement, type SquareName } from './position'

export const SLIDE_MS = 520

export type Flight = {
  id: string
  piece: PieceCode
  from: SquareName
  to: SquareName
}

export function solutionMoves(analysis: Analysis): MateMove[] {
  if (analysis.score_type !== 'mate') return []
  if (analysis.mate_line && analysis.mate_line.length > 0) return analysis.mate_line
  if (!analysis.best_move_uci || !analysis.from_square || !analysis.to_square) return []
  return [
    {
      san: analysis.best_move_san ?? analysis.best_move_uci,
      uci: analysis.best_move_uci,
      from_square: analysis.from_square,
      to_square: analysis.to_square,
    },
  ]
}

export function flightsFor(placement: Placement, move: MateMove, id: string): Flight[] {
  const from = move.from_square as SquareName
  const to = move.to_square as SquareName
  const piece = placement[from]
  if (!piece) return []
  const flights: Flight[] = [{ id, piece, from, to }]
  const fromFile = from.charCodeAt(0)
  const toFile = to.charCodeAt(0)
  if ((piece === 'K' || piece === 'k') && Math.abs(toFile - fromFile) === 2) {
    const rank = from[1]
    const rookFrom = (toFile > fromFile ? `h${rank}` : `a${rank}`) as SquareName
    const rookTo = (toFile > fromFile ? `f${rank}` : `d${rank}`) as SquareName
    const rook = placement[rookFrom]
    if (rook) flights.push({ id: `${id}-rook`, piece: rook, from: rookFrom, to: rookTo })
  }
  return flights
}

export function placementAfter(fen: string, moves: MateMove[], count: number): Placement {
  const chess = new Chess(fen)
  for (let index = 0; index < count; index += 1) {
    const move = moves[index]
    const promotion = move.uci.length > 4 ? (move.uci[4] as PieceSymbol) : undefined
    const played = chess.move({ from: move.from_square, to: move.to_square, promotion })
    if (!played) {
      throw new Error(`Could not play ${move.san}.`)
    }
  }
  return parseFen(chess.fen()).placement
}
