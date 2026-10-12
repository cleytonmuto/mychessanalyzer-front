import { Chess, type Color } from 'chess.js'

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const

export type PieceCode = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p'
export type SquareName = `${(typeof FILES)[number]}${(typeof RANKS)[number]}`
export type Placement = Partial<Record<SquareName, PieceCode>>
export type Castling = { K: boolean; Q: boolean; k: boolean; q: boolean }

export type Position = {
  placement: Placement
  turn: 'w' | 'b'
  castling: Castling
  enPassant: string
  halfmove: number
  fullmove: number
}

export type PositionStatus = {
  valid: boolean
  message: string
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const PIECE_NAMES: Record<PieceCode, string> = {
  K: 'White king',
  Q: 'White queen',
  R: 'White rook',
  B: 'White bishop',
  N: 'White knight',
  P: 'White pawn',
  k: 'Black king',
  q: 'Black queen',
  r: 'Black rook',
  b: 'Black bishop',
  n: 'Black knight',
  p: 'Black pawn',
}

export const PIECE_GLYPHS: Record<PieceCode, string> = {
  K: '♚',
  Q: '♛',
  R: '♜',
  B: '♝',
  N: '♞',
  P: '♟',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
}

export function squareName(file: string, rank: number): SquareName {
  return `${file}${rank}` as SquareName
}

export function parseFen(fen: string): Position {
  const [placement, turn = 'w', castling = '-', enPassant = '-', halfmove = '0', fullmove = '1'] = fen.trim().split(/\s+/)
  const map: Placement = {}
  placement.split('/').forEach((row, rankIndex) => {
    let fileIndex = 0
    for (const char of row) {
      if (char >= '1' && char <= '8') {
        fileIndex += Number(char)
      } else {
        map[squareName(FILES[fileIndex], 8 - rankIndex)] = char as PieceCode
        fileIndex += 1
      }
    }
  })
  const half = Number(halfmove)
  const full = Number(fullmove)
  return {
    placement: map,
    turn: turn === 'b' ? 'b' : 'w',
    castling: {
      K: castling.includes('K'),
      Q: castling.includes('Q'),
      k: castling.includes('k'),
      q: castling.includes('q'),
    },
    enPassant: /^[a-h][36]$/.test(enPassant) ? enPassant : '-',
    halfmove: Number.isInteger(half) && half >= 0 ? half : 0,
    fullmove: Number.isInteger(full) && full >= 1 ? full : 1,
  }
}

export function readFenText(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find((row) => row.length > 0 && !row.startsWith('[') && !row.startsWith('%') && !row.startsWith(';'))
  if (!line) throw new Error('This file does not contain a FEN.')
  const parts = line.split(/\s+/)
  const ranks = parts[0]?.split('/') ?? []
  if (ranks.length !== 8 || ranks.some((rank) => !/^[rnbqkpRNBQKP1-8]+$/.test(rank))) {
    throw new Error('This file is not a valid FEN.')
  }
  for (const rank of ranks) {
    let count = 0
    for (const char of rank) count += char >= '1' && char <= '8' ? Number(char) : 1
    if (count !== 8) throw new Error('This file is not a valid FEN.')
  }
  const turn = parts[1] === 'b' ? 'b' : 'w'
  const castling = parts[2] && /^(-|[KQkq]+)$/.test(parts[2]) ? parts[2] : '-'
  const enPassant = parts[3] && /^(-|[a-h][36])$/.test(parts[3]) ? parts[3] : '-'
  const half = Number(parts[4])
  const full = Number(parts[5])
  return `${parts[0]} ${turn} ${castling} ${enPassant} ${Number.isInteger(half) && half >= 0 ? half : 0} ${Number.isInteger(full) && full >= 1 ? full : 1}`
}

export function startingPosition(): Position {
  return parseFen(START_FEN)
}

export function emptyPosition(): Position {
  return {
    placement: {},
    turn: 'w',
    castling: { K: false, Q: false, k: false, q: false },
    enPassant: '-',
    halfmove: 0,
    fullmove: 1,
  }
}

export function castlingAvailable(placement: Placement, right: keyof Castling): boolean {
  if (right === 'K') return placement.e1 === 'K' && placement.h1 === 'R'
  if (right === 'Q') return placement.e1 === 'K' && placement.a1 === 'R'
  if (right === 'k') return placement.e8 === 'k' && placement.h8 === 'r'
  return placement.e8 === 'k' && placement.a8 === 'r'
}

export function buildFen(position: Position): string {
  const rows: string[] = []
  for (const rank of RANKS) {
    let empty = 0
    let row = ''
    for (const file of FILES) {
      const piece = position.placement[squareName(file, rank)]
      if (!piece) {
        empty += 1
        continue
      }
      if (empty) {
        row += String(empty)
        empty = 0
      }
      row += piece
    }
    if (empty) row += String(empty)
    rows.push(row)
  }

  const rights = (['K', 'Q', 'k', 'q'] as const)
    .filter((right) => position.castling[right] && castlingAvailable(position.placement, right))
    .join('')

  const enPassant = /^[a-h][36]$/.test(position.enPassant) ? position.enPassant : '-'
  const halfmove = Number.isInteger(position.halfmove) && position.halfmove >= 0 ? position.halfmove : 0
  const fullmove = Number.isInteger(position.fullmove) && position.fullmove >= 1 ? position.fullmove : 1
  return `${rows.join('/')} ${position.turn} ${rights || '-'} ${enPassant} ${halfmove} ${fullmove}`
}

export function withoutPiece(placement: Placement, square: SquareName): Placement {
  if (!placement[square]) return placement
  const next = { ...placement }
  delete next[square]
  return next
}

function friendlyFenError(message: string): string {
  const text = message.replace(/^Invalid FEN:\s*/i, '')
  if (text.includes('king')) return 'Place exactly one white king and one black king.'
  if (text.includes('edge rows')) return 'Pawns cannot stand on the first or eighth rank.'
  const sentence = text.charAt(0).toUpperCase() + text.slice(1)
  return sentence.endsWith('.') ? sentence : `${sentence}.`
}

export function describePosition(position: Position): PositionStatus {
  const pieces = Object.entries(position.placement) as [SquareName, PieceCode][]
  const white = pieces.filter(([, piece]) => piece === piece.toUpperCase())
  const black = pieces.filter(([, piece]) => piece === piece.toLowerCase())

  if (white.filter(([, piece]) => piece === 'K').length !== 1 || black.filter(([, piece]) => piece === 'k').length !== 1) {
    return { valid: false, message: 'Place exactly one white king and one black king.' }
  }
  if (white.filter(([, piece]) => piece === 'P').length > 8 || black.filter(([, piece]) => piece === 'p').length > 8) {
    return { valid: false, message: 'Each side can have at most eight pawns.' }
  }
  if (white.length > 16 || black.length > 16) {
    return { valid: false, message: 'Each side can have at most sixteen pieces.' }
  }
  if (pieces.some(([square, piece]) => (piece === 'P' || piece === 'p') && (square.endsWith('1') || square.endsWith('8')))) {
    return { valid: false, message: 'Pawns cannot stand on the first or eighth rank.' }
  }

  try {
    const chess = new Chess(buildFen(position))
    const opponent: Color = chess.turn() === 'w' ? 'b' : 'w'
    const [king] = chess.findPiece({ type: 'k', color: opponent })
    if (king && chess.isAttacked(king, chess.turn())) {
      const mover = chess.turn() === 'w' ? 'White' : 'Black'
      const other = mover === 'White' ? 'Black' : 'White'
      return {
        valid: false,
        message: `${other}'s king is in check, but it is ${mover}'s turn. Switch the side to move, or move that king out of check.`,
      }
    }
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White'
      return { valid: true, message: `Legal position. ${winner} has already delivered checkmate.` }
    }
    if (chess.isStalemate()) {
      return { valid: true, message: 'Legal position. Stalemate.' }
    }
    if (chess.isInsufficientMaterial()) {
      return { valid: true, message: 'Legal position. Neither side has enough material to force mate.' }
    }
    if (chess.isDraw()) {
      return { valid: true, message: 'Legal position. The game is drawn.' }
    }
    return { valid: true, message: 'Legal position. Ready to analyze.' }
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'This position is not legal.'
    return { valid: false, message: friendlyFenError(raw) }
  }
}
