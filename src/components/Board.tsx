import { useEffect, useRef, type PointerEvent } from 'react'
import { FILES, PIECE_GLYPHS, PIECE_NAMES, RANKS, squareName, type Placement, type SquareName } from '../position'
import { SLIDE_MS, type Flight } from '../solution'

export type Orientation = 'white' | 'black'

type BoardProps = {
  placement: Placement
  fromSquare: string | null
  toSquare: string | null
  dragFrom: SquareName | null
  dragOver: SquareName | null
  flights: Flight[]
  targets?: readonly SquareName[]
  orientation?: Orientation
  locked: boolean
  onDragPiece: (square: SquareName, event: PointerEvent<HTMLButtonElement>) => void
  onLockedPointerDown: () => void
}

function cell(square: string, orientation: Orientation) {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1])
  return {
    fileIndex: orientation === 'white' ? file : 7 - file,
    rankFromTop: orientation === 'white' ? 8 - rank : rank - 1,
  }
}

function squarePercent(square: string, orientation: Orientation) {
  const { fileIndex, rankFromTop } = cell(square, orientation)
  return {
    x: `${((fileIndex + 0.5) / 8) * 100}%`,
    y: `${((rankFromTop + 0.5) / 8) * 100}%`,
  }
}

function Flyer({ flight, orientation }: { flight: Flight; orientation: Orientation }) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = squarePercent(flight.from, orientation)
  const to = squarePercent(flight.to, orientation)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const animation = element.animate(
      [
        { left: from.x, top: from.y },
        { left: to.x, top: to.y },
      ],
      { duration: SLIDE_MS, easing: 'cubic-bezier(0.22, 0.7, 0.2, 1)', fill: 'forwards' },
    )
    return () => animation.cancel()
  }, [from.x, from.y, to.x, to.y])
  const white = flight.piece === flight.piece.toUpperCase()
  return (
    <span ref={ref} className={white ? 'flyer piece white' : 'flyer piece black'} style={{ left: from.x, top: from.y }}>
      {PIECE_GLYPHS[flight.piece]}
    </span>
  )
}

function arrowEnds(from: string, to: string, orientation: Orientation) {
  const start = cell(from, orientation)
  const end = cell(to, orientation)
  const x1 = start.fileIndex + 0.5
  const y1 = start.rankFromTop + 0.5
  const x2 = end.fileIndex + 0.5
  const y2 = end.rankFromTop + 0.5
  return {
    x1,
    y1,
    x2: x1 + (x2 - x1) * 0.72,
    y2: y1 + (y2 - y1) * 0.72,
  }
}

export default function Board({
  placement,
  fromSquare,
  toSquare,
  dragFrom,
  dragOver,
  flights,
  targets = [],
  orientation = 'white',
  locked,
  onDragPiece,
  onLockedPointerDown,
}: BoardProps) {
  const arrow = fromSquare && toSquare ? arrowEnds(fromSquare, toSquare, orientation) : null
  const hidden = new Set(flights.map((flight) => flight.from))
  const targetSet = new Set(targets)
  const files = orientation === 'white' ? FILES : [...FILES].reverse()
  const ranks = orientation === 'white' ? RANKS : [...RANKS].reverse()
  const leftFile = files[0]
  const bottomRank = ranks[ranks.length - 1]

  return (
    <div className="board-frame">
      <div className={locked ? 'board locked' : 'board'}>
        {ranks.map((rank) =>
          files.map((file) => {
            const square = squareName(file, rank)
            const piece = placement[square]
            const visible = piece && !hidden.has(square)
            const light = (file.charCodeAt(0) + rank) % 2 === 1
            const classes = [
              'square',
              light ? 'light' : 'dark',
              visible ? 'occupied' : '',
              square === fromSquare ? 'from' : '',
              square === toSquare ? 'to' : '',
              square === dragFrom ? 'lifting' : '',
              square === dragOver && square !== dragFrom ? 'drop' : '',
              targetSet.has(square) ? 'target' : '',
            ]
              .filter(Boolean)
              .join(' ')
            const label = visible && piece ? `${square}, ${PIECE_NAMES[piece]}` : `${square}, empty`
            return (
              <button
                key={square}
                type="button"
                className={classes}
                data-square={square}
                aria-label={label}
                onPointerDown={(event) => {
                  if (locked) {
                    event.preventDefault()
                    onLockedPointerDown()
                    return
                  }
                  if (!piece) return
                  onDragPiece(square, event)
                }}
              >
                {file === leftFile && <span className="coord rank">{rank}</span>}
                {rank === bottomRank && <span className="coord file">{file}</span>}
                {visible && piece && (
                  <span className={piece === piece.toUpperCase() ? 'piece white' : 'piece black'}>{PIECE_GLYPHS[piece]}</span>
                )}
                {targetSet.has(square) && <span className={piece ? 'hint capture' : 'hint'} />}
              </button>
            )
          }),
        )}
        {arrow && (
          <svg className="arrow-layer" viewBox="0 0 8 8" aria-hidden="true">
            <defs>
              <marker id="best-move-head" markerWidth="3" markerHeight="3" refX="1.2" refY="1.5" orient="auto">
                <path d="M0,0 L3,1.5 L0,3 Z" fill="#f4e3a1" />
              </marker>
            </defs>
            <line
              x1={arrow.x1}
              y1={arrow.y1}
              x2={arrow.x2}
              y2={arrow.y2}
              stroke="#f4e3a1"
              strokeWidth="0.16"
              strokeLinecap="round"
              markerEnd="url(#best-move-head)"
            />
          </svg>
        )}
        {flights.map((flight) => (
          <Flyer key={flight.id} flight={flight} orientation={orientation} />
        ))}
      </div>
    </div>
  )
}
