import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { analyzePosition, listAnalyses, listPositions, saveFen, type Analysis, type SavedPosition } from './api'
import Board from './components/Board'
import PieceTray from './components/PieceTray'
import PlayGame from './components/PlayGame'
import {
  buildFen,
  castlingAvailable,
  describePosition,
  emptyPosition,
  parseFen,
  PIECE_GLYPHS,
  readFenText,
  startingPosition,
  withoutPiece,
  type Castling,
  type PieceCode,
  type Placement,
  type Position,
  type SquareName,
} from './position'
import { flightsFor, placementAfter, SLIDE_MS, solutionMoves, type Flight } from './solution'

const CASTLING_RIGHTS: { right: keyof Castling; label: string }[] = [
  { right: 'K', label: 'White O-O' },
  { right: 'Q', label: 'White O-O-O' },
  { right: 'k', label: 'Black O-O' },
  { right: 'q', label: 'Black O-O-O' },
]

function moveMarker(fen: string, index: number): string {
  const blackMovesFirst = fen.split(' ')[1] === 'b'
  const whiteMove = index % 2 === 0 ? !blackMovesFirst : blackMovesFirst
  const moveNumber = 1 + Math.floor((index + (blackMovesFirst ? 1 : 0)) / 2)
  return whiteMove ? `${moveNumber}.` : `${moveNumber}...`
}

type DragSource =
  | { kind: 'board'; square: SquareName; piece: PieceCode }
  | { kind: 'tray'; piece: PieceCode }

type DragState = {
  source: DragSource
  pointerId: number
  x: number
  y: number
  over: SquareName | null
}

type Playback = {
  fen: string
  placement: Placement
  moveIndex: number
  from: string
  to: string
  flights: Flight[]
  status: 'playing' | 'done'
}

const LEAD_MS = 280
const HOLD_MS = 760

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function squareUnder(x: number, y: number): SquareName | null {
  const hit = document.elementsFromPoint(x, y).find((element) => element.closest('[data-square]'))
  const square = hit?.closest('[data-square]')?.getAttribute('data-square')
  return square ? (square as SquareName) : null
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function downloadFen(fen: string) {
  const blob = new Blob([`${fen}\n`], { type: 'application/x-chess-fen' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'position.fen'
  link.click()
  URL.revokeObjectURL(url)
}

function edited(position: Position, placement: Placement): Position {
  return { ...position, placement, enPassant: '-', halfmove: 0 }
}

export default function App() {
  const [position, setPosition] = useState<Position>(startingPosition)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [history, setHistory] = useState<Analysis[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [mode, setMode] = useState<'play' | 'analyze'>('analyze')
  const [blackAtBottom, setBlackAtBottom] = useState(false)
  const [playDragging, setPlayDragging] = useState(false)
  const [positions, setPositions] = useState<SavedPosition[]>([])
  const [fenNote, setFenNote] = useState<string | null>(null)
  const onPlayDragging = useCallback((dragging: boolean) => setPlayDragging(dragging), [])
  const dragRef = useRef<DragState | null>(null)
  const playToken = useRef(0)
  const fenFileRef = useRef<HTMLInputElement>(null)

  const fen = useMemo(() => buildFen(position), [position])
  const status = useMemo(() => describePosition(position), [position])
  const active = analysis?.fen === fen ? analysis : null
  const moves = active ? solutionMoves(active) : []
  const shown = playback !== null && playback.fen === fen
  const playing = shown && playback.status === 'playing'

  useEffect(() => {
    document.title = mode === 'play' ? 'Play Stockfish' : 'Chess Analyzer'
  }, [mode])

  useEffect(() => {
    let activeRequest = true
    listAnalyses()
      .then((items) => {
        if (activeRequest) setHistory(items)
      })
      .catch(() => {
        if (activeRequest) setError('The analyzer is not running. Start the backend and try again.')
      })
    return () => {
      activeRequest = false
    }
  }, [])

  useEffect(() => {
    let activeRequest = true
    listPositions()
      .then((items) => {
        if (activeRequest) setPositions(items)
      })
      .catch(() => {
        if (activeRequest) setFenNote('Saved positions could not be loaded.')
      })
    return () => {
      activeRequest = false
    }
  }, [])

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const current = dragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      const next = { ...current, x: event.clientX, y: event.clientY, over: squareUnder(event.clientX, event.clientY) }
      dragRef.current = next
      setDrag(next)
    }

    function onUp(event: PointerEvent) {
      const current = dragRef.current
      if (!current || event.pointerId !== current.pointerId) return
      const over = squareUnder(event.clientX, event.clientY)
      dragRef.current = null
      setDrag(null)
      playToken.current += 1
      setPlayback(null)
      if (current.source.kind === 'tray') {
        if (!over) return
        const piece = current.source.piece
        setPosition((board) => edited(board, { ...board.placement, [over]: piece }))
        return
      }
      if (!over) {
        const square = current.source.square
        setPosition((board) => edited(board, withoutPiece(board.placement, square)))
        return
      }
      if (over === current.source.square) return
      const from = current.source.square
      setPosition((board) => {
        const piece = board.placement[from]
        if (!piece) return board
        return edited(board, { ...withoutPiece(board.placement, from), [over]: piece })
      })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  useEffect(() => {
    return () => {
      playToken.current += 1
    }
  }, [])

  function stopPlayback() {
    playToken.current += 1
    setPlayback(null)
  }

  function updatePosition(next: Position | ((current: Position) => Position)) {
    stopPlayback()
    setFenNote(null)
    setPosition(next)
  }

  function showSolution() {
    if (!active || moves.length === 0) return
    const token = playToken.current + 1
    playToken.current = token
    const fenNow = active.fen
    const line = moves
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let placement = parseFen(fenNow).placement
    const still = () => playToken.current === token

    setPlayback({
      fen: fenNow,
      placement,
      moveIndex: 0,
      from: line[0].from_square,
      to: line[0].to_square,
      flights: [],
      status: 'playing',
    })

    void (async () => {
      try {
        await wait(reduceMotion ? 160 : LEAD_MS)
        for (let index = 0; index < line.length; index += 1) {
          if (!still()) return
          const move = line[index]
          const flights = reduceMotion ? [] : flightsFor(placement, move, `${token}-${index}`)
          setPlayback({
            fen: fenNow,
            placement,
            moveIndex: index,
            from: move.from_square,
            to: move.to_square,
            flights,
            status: 'playing',
          })
          if (!reduceMotion) await wait(SLIDE_MS + 40)
          if (!still()) return
          placement = placementAfter(fenNow, line, index + 1)
          const last = index === line.length - 1
          setPlayback({
            fen: fenNow,
            placement,
            moveIndex: index,
            from: move.from_square,
            to: move.to_square,
            flights: [],
            status: last ? 'done' : 'playing',
          })
          if (!last) await wait(reduceMotion ? 900 : HOLD_MS)
        }
      } catch {
        if (still()) setPlayback(null)
      }
    })()
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, source: DragSource) {
    if (shown) {
      stopPlayback()
      return
    }
    if (event.button !== 0) return
    event.preventDefault()
    const next = { source, pointerId: event.pointerId, x: event.clientX, y: event.clientY, over: null }
    dragRef.current = next
    setDrag(next)
  }

  function loadFen(value: string) {
    stopPlayback()
    setPosition(parseFen(value))
    setError(null)
    setFenNote(null)
  }

  async function saveBoard() {
    downloadFen(fen)
    try {
      const stored = await saveFen(fen)
      setPositions((items) => [stored, ...items.filter((item) => item.id !== stored.id)].slice(0, 12))
      setFenNote('Saved. The FEN file was downloaded.')
    } catch (caught) {
      setFenNote(caught instanceof Error ? caught.message : 'The position could not be saved.')
    }
  }

  async function onFenFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      loadFen(readFenText(await file.text()))
      setFenNote('FEN loaded.')
    } catch (caught) {
      setFenNote(caught instanceof Error ? caught.message : 'This file is not a valid FEN.')
    }
  }

  function loadAnalysis(item: Analysis) {
    stopPlayback()
    setPosition(parseFen(item.fen))
    setAnalysis(item)
    setError(null)
  }

  async function onAnalyze() {
    stopPlayback()
    setLoading(true)
    setError(null)
    try {
      const result = await analyzePosition(fen)
      setAnalysis(result)
      setHistory((items) => [result, ...items.filter((item) => item.id !== result.id)].slice(0, 8))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Analysis failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={drag || playDragging ? 'app dragging' : 'app'}>
      <div className="layout">
        <header className="header">
          <p className="mark">♞</p>
          <div>
            <h1>{mode === 'play' ? 'Play Stockfish' : 'Chess Analyzer'}</h1>
            <p>
              {mode === 'play'
                ? 'Drag your pieces through a full game. Stockfish plays the other side.'
                : 'Set up a legal position, then ask Stockfish for the best move.'}
            </p>
          </div>
          <div className="modes" role="tablist" aria-label="Mode">
            <button type="button" role="tab" aria-selected={mode === 'play'} onClick={() => setMode('play')}>
              Play
            </button>
            <button type="button" role="tab" aria-selected={mode === 'analyze'} onClick={() => setMode('analyze')}>
              Analyze
            </button>
          </div>
        </header>

        <div className="play-slot" hidden={mode !== 'play'}>
          <PlayGame onDraggingChange={onPlayDragging} clockActive={mode === 'play'} />
        </div>

        <div className="analyze-panel" hidden={mode !== 'analyze'}>
        <section className="board-column" aria-label="Board setup">
          <PieceTray onDragPiece={(piece, event) => beginDrag(event, { kind: 'tray', piece })} />
          <Board
            placement={shown ? playback.placement : position.placement}
            fromSquare={shown ? playback.from : (active?.from_square ?? null)}
            toSquare={shown ? playback.to : (active?.to_square ?? null)}
            dragFrom={drag?.source.kind === 'board' ? drag.source.square : null}
            dragOver={drag?.over ?? null}
            flights={shown ? playback.flights : []}
            orientation={blackAtBottom ? 'black' : 'white'}
            locked={shown}
            onLockedPointerDown={() => {
              if (playback?.status === 'done') stopPlayback()
            }}
            onDragPiece={(square, event) => {
              const piece = position.placement[square]
              if (!piece) return
              beginDrag(event, { kind: 'board', square, piece })
            }}
          />

          <div className="controls">
            <div className="turn" role="group" aria-label="Board direction">
              <button type="button" aria-pressed={!blackAtBottom} onClick={() => setBlackAtBottom(false)}>
                White at the bottom
              </button>
              <button type="button" aria-pressed={blackAtBottom} onClick={() => setBlackAtBottom(true)}>
                Black at the bottom
              </button>
            </div>
            <div className="turn" role="group" aria-label="Side to move">
              <button type="button" aria-pressed={position.turn === 'w'} onClick={() => updatePosition((current) => ({ ...current, turn: 'w', enPassant: '-' }))}>
                White to move
              </button>
              <button type="button" aria-pressed={position.turn === 'b'} onClick={() => updatePosition((current) => ({ ...current, turn: 'b', enPassant: '-' }))}>
                Black to move
              </button>
            </div>

            <fieldset className="castling">
              <legend>Castling</legend>
              {CASTLING_RIGHTS.map(({ right, label }) => {
                const available = castlingAvailable(position.placement, right)
                return (
                  <label key={right}>
                    <input
                      type="checkbox"
                      checked={available && position.castling[right]}
                      disabled={!available}
                      onChange={(event) =>
                        updatePosition((current) => ({
                          ...current,
                          castling: { ...current.castling, [right]: event.target.checked },
                        }))
                      }
                    />
                    {label}
                  </label>
                )
              })}
            </fieldset>

            <p className="fen">{fen}</p>
            <p className={status.valid ? 'status valid' : 'status invalid'}>{status.message}</p>

            <div className="actions">
              <button type="button" className="secondary" onClick={() => updatePosition(startingPosition())}>
                Starting position
              </button>
              <button type="button" className="secondary" onClick={() => updatePosition(emptyPosition())}>
                Clear board
              </button>
              <button type="button" className="analyze" disabled={!status.valid || loading} onClick={() => void onAnalyze()}>
                {loading ? 'Analyzing…' : 'Analyze'}
              </button>
              <button type="button" className="secondary" onClick={() => void saveBoard()}>
                Save FEN
              </button>
              <button type="button" className="secondary" onClick={() => fenFileRef.current?.click()}>
                Open FEN
              </button>
              <input ref={fenFileRef} type="file" accept=".fen,.txt,text/plain" hidden onChange={(event) => void onFenFile(event)} />
            </div>
            {fenNote && <p className="playback-note">{fenNote}</p>}
          </div>
        </section>

        <aside className="result-column" aria-live="polite">
          <section className="result-card">
            <h2>Best move</h2>
            {error && <p className="banner">{error}</p>}
            {loading && <p className="searching">Stockfish is searching…</p>}
            {!loading && active && (
              <>
                {active.best_move_san ? (
                  <>
                    <p className="move">{active.best_move_san}</p>
                    <p className="route">
                      {active.from_square} → {active.to_square}
                    </p>
                  </>
                ) : (
                  <p className="move quiet">No move</p>
                )}
                <p className={`verdict ${active.score_type}`}>{active.evaluation_label}</p>
                {moves.length > 0 && (
                  <div className="solution-actions">
                    <button
                      type="button"
                      className={playing ? 'show-solution stop' : 'show-solution'}
                      onClick={() => (playing ? stopPlayback() : showSolution())}
                    >
                      {playing ? 'Stop' : shown ? 'Show again' : 'Show solution'}
                    </button>
                    {shown && playback.status === 'done' && (
                      <button type="button" className="secondary" onClick={stopPlayback}>
                        Back to position
                      </button>
                    )}
                  </div>
                )}
                {shown && (
                  <p className="playback-note">
                    {playback.status === 'done'
                      ? 'Checkmate. The line is on the board.'
                      : `Playing ${moveMarker(active.fen, playback.moveIndex)} ${moves[playback.moveIndex]?.san ?? ''}`}
                  </p>
                )}
                {active.mate_line && active.mate_line.length > 1 && (
                  <ol className="mate-line">
                    {active.mate_line.map((move, index) => (
                      <li key={`${move.uci}-${index}`} className={shown && playback.moveIndex === index ? 'current' : ''} aria-current={shown && playback.moveIndex === index ? 'step' : undefined}>
                        <span className="mate-number">{moveMarker(active.fen, index)}</span>
                        <span className="mate-san">{move.san}</span>
                        <span className="mate-squares">
                          {move.from_square} → {move.to_square}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {active.depth > 0 && <p className="depth">Searched to depth {active.depth}.</p>}
              </>
            )}
            {!loading && !active && !error && (
              <p className="prompt">
                Press Analyze on a legal position. The result is the best move, with a forced mate or the advantage in pawns.
              </p>
            )}
          </section>

          <section className="history">
            <h2>Recent analyses</h2>
            {history.length === 0 ? (
              <p className="prompt">Analyses you run are saved here.</p>
            ) : (
              <ul>
                {history.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={item.fen === fen ? 'current' : ''} onClick={() => loadAnalysis(item)}>
                      <span className="history-move">{item.best_move_san ?? 'Finished'}</span>
                      <span className="history-label">{item.evaluation_label}</span>
                      <span className="history-when">{formatWhen(item.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="history">
            <h2>Saved positions</h2>
            {positions.length === 0 ? (
              <p className="prompt">Saved FEN positions appear here.</p>
            ) : (
              <ul>
                {positions.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={item.fen === fen ? 'current' : ''} onClick={() => loadFen(item.fen)}>
                      <span className="history-move">{item.fen.split(' ')[1] === 'b' ? 'Black to move' : 'White to move'}</span>
                      <span className="history-label">{item.fen}</span>
                      <span className="history-when">{formatWhen(item.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
        </div>
      </div>
      {drag && (
        <div
          className={drag.source.piece === drag.source.piece.toUpperCase() ? 'drag-ghost piece white' : 'drag-ghost piece black'}
          style={{ left: drag.x, top: drag.y }}
        >
          {PIECE_GLYPHS[drag.source.piece]}
        </div>
      )}
    </main>
  )
}
