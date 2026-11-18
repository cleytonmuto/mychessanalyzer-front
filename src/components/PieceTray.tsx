import type { PointerEvent } from 'react'
import { PieceView } from './PieceView'
import { PIECE_NAMES, type PieceCode } from '../position'

const WHITE: PieceCode[] = ['K', 'Q', 'R', 'B', 'N', 'P']
const BLACK: PieceCode[] = ['k', 'q', 'r', 'b', 'n', 'p']

type PieceTrayProps = {
  onDragPiece: (piece: PieceCode, event: PointerEvent<HTMLButtonElement>) => void
}

export default function PieceTray({ onDragPiece }: PieceTrayProps) {
  return (
    <div className="tray" role="toolbar" aria-label="Pieces">
      <div className="tray-row">
        {WHITE.map((piece) => (
          <button
            key={piece}
            type="button"
            className="tray-piece white"
            aria-label={PIECE_NAMES[piece]}
            onPointerDown={(event) => onDragPiece(piece, event)}
          >
            <PieceView code={piece} />
          </button>
        ))}
      </div>
      <div className="tray-row">
        {BLACK.map((piece) => (
          <button
            key={piece}
            type="button"
            className="tray-piece black"
            aria-label={PIECE_NAMES[piece]}
            onPointerDown={(event) => onDragPiece(piece, event)}
          >
            <PieceView code={piece} />
          </button>
        ))}
      </div>
    </div>
  )
}
