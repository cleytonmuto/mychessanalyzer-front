import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Chess, type PieceSymbol, type Square } from 'chess.js'
import { listGames, requestEngineMove, reviewPosition, savePgn, type ReviewEval, type SavedGame } from '../api'
import { parseFen, PIECE_GLYPHS, type PieceCode, type SquareName } from '../position'
import { flightsFor, SLIDE_MS } from '../solution'
import Board from './Board'

type Side = 'w' | 'b'
type Level = 'easy' | 'medium' | 'strong'

type DragState = {
  square: SquareName
  piece: PieceCode
  pointerId: number
  x: number
  y: number
  over: SquareName | null
}

type Slide = {
  placement: ReturnType<typeof parseFen>['placement']
  flights: ReturnType<typeof flightsFor>
  from: string
  to: string
}

type PendingPromotion = {
  from: SquareName
  to: SquareName
}

const DEPTH: Record<Level, number> = { easy: 6, medium: 10, strong: 16 }
const REVIEW_DEPTH = 10

type MoveJudgment = {
  label: string
  kind: 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
  bestSan: string
}

function whiteCentipawns(evaluation: ReviewEval): number | null {
  if (evaluation.score_type === 'mate') {
    if (evaluation.score_value === null || evaluation.score_value === 0) return null
    const sign = evaluation.score_value > 0 ? 1 : -1
    return sign * (10000 - Math.min(Math.abs(evaluation.score_value), 50))
  }
  if (evaluation.score_type === 'cp') return evaluation.score_value ?? 0
  return null
}

function judgeMove(playedSan: string, playedUci: string, whiteMoved: boolean, before: ReviewEval, after: ReviewEval | undefined): MoveJudgment | null {
  if (!before.best_move_san) return null
  const bestSan = before.best_move_san
  if (before.best_move_uci === playedUci || bestSan === playedSan) {
    return { label: 'Best', kind: 'best', bestSan }
  }
  const beforeCp = whiteCentipawns(before)
  const afterCp = after ? whiteCentipawns(after) : null
  if (beforeCp === null || afterCp === null) return { label: 'Good', kind: 'good', bestSan }
  const loss = whiteMoved ? beforeCp - afterCp : afterCp - beforeCp
  if (loss < 20) return { label: 'Excellent', kind: 'excellent', bestSan }
  if (loss < 50) return { label: 'Good', kind: 'good', bestSan }
  if (loss < 100) return { label: 'Inaccuracy', kind: 'inaccuracy', bestSan }
  if (loss < 200) return { label: 'Mistake', kind: 'mistake', bestSan }
  return { label: 'Blunder', kind: 'blunder', bestSan }
}

function judgmentText(played: string, judgment: MoveJudgment): string {
  if (judgment.kind === 'best') return `${played} is the best move.`
  const word = judgment.label.toLowerCase()
  const phrase = judgment.kind === 'excellent' || judgment.kind === 'good' ? word : `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
  return `${played} is ${phrase}. The best move was ${judgment.bestSan}.`
}

function terminalEval(chess: Chess): ReviewEval {
  if (chess.isCheckmate()) {
    const whiteMated = chess.turn() === 'w'
    return { best_move_uci: null, best_move_san: null, score_type: 'mate', score_value: whiteMated ? -1 : 1, depth: 0 }
  }
  return { best_move_uci: null, best_move_san: null, score_type: 'cp', score_value: 0, depth: 0 }
}

const LEVELS: { id: Level; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'strong', label: 'Strong' },
]

const PROMOTE: { piece: PieceSymbol; name: string }[] = [
  { piece: 'q', name: 'Queen' },
  { piece: 'r', name: 'Rook' },
  { piece: 'b', name: 'Bishop' },
  { piece: 'n', name: 'Knight' },
]

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

function replay(sans: string[]) {
  const chess = new Chess()
  for (const san of sans) chess.move(san)
  return chess
}

function outcome(chess: Chess, side: Side, resigned: boolean): string | null {
  if (resigned) return 'You resigned. Stockfish wins.'
  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'b' : 'w'
    return winner === side ? 'Checkmate. You win.' : 'Checkmate. Stockfish wins.'
  }
  if (chess.isStalemate()) return 'Stalemate. The game is drawn.'
  if (chess.isThreefoldRepetition()) return 'Draw by threefold repetition.'
  if (chess.isInsufficientMaterial()) return 'Draw by insufficient material.'
  if (chess.isDraw()) return 'Draw.'
  return null
}

function yourTurn(chess: Chess): string {
  return chess.isCheck() ? 'Your turn. Check.' : 'Your turn.'
}

function pgnDate(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}.${month}.${day}`
}

function resultTag(chess: Chess, side: Side, resigned: boolean): string {
  if (resigned) return side === 'w' ? '0-1' : '1-0'
  if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0'
  if (chess.isDraw()) return '1/2-1/2'
  return '*'
}

function buildPgn(moves: string[], side: Side, resigned: boolean): string {
  const chess = replay(moves)
  chess.setHeader('Event', 'Play Stockfish')
  chess.setHeader('Site', 'Chess Analyzer')
  chess.setHeader('Date', pgnDate())
  chess.setHeader('Round', '-')
  chess.setHeader('White', side === 'w' ? 'You' : 'Stockfish')
  chess.setHeader('Black', side === 'b' ? 'You' : 'Stockfish')
  chess.setHeader('Result', resultTag(chess, side, resigned))
  return chess.pgn()
}

function downloadPgn(pgn: string, name: string) {
  const blob = new Blob([pgn], { type: 'application/x-chess-pgn' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function moveLabel(moves: string[], ply: number): string {
  if (ply <= 0) return 'Starting position.'
  const san = moves[ply - 1]
  const number = Math.ceil(ply / 2)
  return ply % 2 === 1 ? `${number}. ${san}` : `${number}... ${san}`
}

function reviewResult(headers: Record<string, string>, chess: Chess): string {
  if (headers.Result === '1-0') return `${headers.White || 'White'} wins.`
  if (headers.Result === '0-1') return `${headers.Black || 'Black'} wins.`
  if (headers.Result === '1/2-1/2') return 'The game is drawn.'
  if (chess.isCheckmate()) return chess.turn() === 'w' ? `${headers.Black || 'Black'} wins.` : `${headers.White || 'White'} wins.`
  if (chess.isDraw()) return 'The game is drawn.'
  return 'Reviewing a saved game.'
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

type PlayGameProps = {
  onDraggingChange: (dragging: boolean) => void
  clockActive: boolean
}

type Clock = { w: number; b: number; running: Side | null; since: number }

function PlayerSeat({
  name,
  color,
  ms,
  running,
  place,
}: {
  name: string
  color: string
  ms: number
  running: boolean
  place: 'top' | 'bottom'
}) {
  const time = formatClock(ms)
  return (
    <div className={place === 'top' ? 'player-seat top' : 'player-seat bottom'}>
      <p className="player-name">
        {name}
        <span className="player-color">{color}</span>
      </p>
      <p className={running ? 'clock running' : 'clock'} aria-label={`${name}, ${color}, ${time}`}>
        {time}
      </p>
    </div>
  )
}

export default function PlayGame({ onDraggingChange, clockActive }: PlayGameProps) {
  const token = useRef(0)
  const requestId = useRef(0)
  const dragRef = useRef<DragState | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [side, setSide] = useState<Side>('w')
  const [fromTop, setFromTop] = useState(false)
  const [level, setLevel] = useState<Level>('medium')
  const [sans, setSans] = useState<string[]>([])
  const [viewPly, setViewPly] = useState(0)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [resigned, setResigned] = useState(false)
  const [sourcePgn, setSourcePgn] = useState<string | null>(null)
  const [notice, setNotice] = useState('Your turn.')
  const [result, setResult] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [slide, setSlide] = useState<Slide | null>(null)
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null)
  const [failed, setFailed] = useState(false)
  const [saved, setSaved] = useState<SavedGame[]>([])
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [judgments, setJudgments] = useState<(MoveJudgment | null)[]>([])
  const [reviewProgress, setReviewProgress] = useState<string | null>(null)
  const reviewToken = useRef(0)
  const [spent, setSpent] = useState({ w: 0, b: 0 })
  const clockRef = useRef<Clock>({ w: 0, b: 0, running: null, since: 0 })

  const game = useMemo(() => replay(sans), [sans])
  const shown = useMemo(() => replay(sans.slice(0, viewPly)), [sans, viewPly])
  const placement = parseFen(shown.fen()).placement
  const atLive = viewPly === sans.length && !reviewOnly
  const activeSide: Side | null = clockActive && atLive && result === null ? game.turn() : null
  const busy = thinking || slide !== null || promotion !== null || result !== null || !atLive
  const verbose = shown.history({ verbose: true })
  const previous = verbose.at(-1)
  const targets: SquareName[] = drag && atLive
    ? [...new Set(game.moves({ square: drag.square as Square, verbose: true }).map((move) => move.to as SquareName))]
    : []
  const statusText = thinking && !slide ? 'Stockfish is thinking…' : viewPly < sans.length || reviewOnly ? (viewPly < sans.length ? moveLabel(sans, viewPly) : (result ?? 'Reviewing a saved game.')) : notice

  useEffect(() => {
    const clock = clockRef.current
    const now = performance.now()
    if (clock.running) clock[clock.running] += now - clock.since
    clock.running = activeSide
    clock.since = now
    setSpent({ w: clock.w, b: clock.b })
    if (!activeSide) return
    const timer = window.setInterval(() => {
      const current = clockRef.current
      const tick = performance.now()
      setSpent({
        w: current.w + (current.running === 'w' ? tick - current.since : 0),
        b: current.b + (current.running === 'b' ? tick - current.since : 0),
      })
    }, 200)
    return () => window.clearInterval(timer)
  }, [activeSide])

  function resetClocks(running: Side | null) {
    clockRef.current = { w: 0, b: 0, running, since: performance.now() }
    setSpent({ w: 0, b: 0 })
  }

  useEffect(() => {
    let active = true
    listGames()
      .then((items) => {
        if (active) setSaved(items)
      })
      .catch(() => {
        if (active) setSaveNote('Saved games could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!reviewOnly || sans.length === 0) return
    const id = ++reviewToken.current
    const moves = sans
    const chess = new Chess()
    void (async () => {
      const evaluations: ReviewEval[] = []
      try {
        for (let index = 0; index <= moves.length; index += 1) {
          if (reviewToken.current !== id) return
          evaluations.push(chess.isGameOver() ? terminalEval(chess) : await reviewPosition(chess.fen(), REVIEW_DEPTH))
          if (reviewToken.current !== id) return
          if (index === moves.length) break
          if (!chess.move(moves[index])) throw new Error('This PGN contains a move that is not legal.')
          setReviewProgress(index + 1 === moves.length ? 'Finishing the review.' : `Checking move ${index + 2} of ${moves.length}.`)
        }
        if (reviewToken.current !== id) return
        const verbose = replay(moves).history({ verbose: true })
        setJudgments(moves.map((san, index) => judgeMove(san, verbose[index]?.lan ?? '', index % 2 === 0, evaluations[index], evaluations[index + 1])))
        setReviewProgress(null)
      } catch (error) {
        if (reviewToken.current !== id) return
        setReviewProgress(error instanceof Error ? error.message : 'The review could not be finished.')
      }
    })()
    return () => {
      reviewToken.current += 1
    }
  }, [reviewOnly, sans])

  function publishDrag(next: DragState | null) {
    dragRef.current = next
    setDrag(next)
    onDraggingChange(next !== null)
  }

  async function askEngine(current: string[], id: number, playing: Side, depth: number) {
    const req = ++requestId.current
    setThinking(true)
    setFailed(false)
    try {
      const before = replay(current)
      const reply = await requestEngineMove(before.fen(), depth, current)
      if (token.current !== id || requestId.current !== req) return
      const flights = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? []
        : flightsFor(parseFen(before.fen()).placement, reply, `engine-${req}`)
      setSlide({ placement: parseFen(before.fen()).placement, flights, from: reply.from_square, to: reply.to_square })
      setNotice(`Stockfish played ${reply.san}.`)
      if (flights.length > 0) await wait(SLIDE_MS + 40)
      if (token.current !== id || requestId.current !== req) return
      const promotionPiece = reply.uci.length > 4 ? (reply.uci[4] as PieceSymbol) : undefined
      const played = before.move({ from: reply.from_square, to: reply.to_square, promotion: promotionPiece })
      if (!played) throw new Error('Stockfish returned a move that is not legal.')
      setSlide(null)
      setSans([...current, played.san])
      setViewPly(current.length + 1)
      setSourcePgn(null)
      const done = outcome(before, playing, false)
      setResult(done)
      setNotice(done ?? yourTurn(before))
    } catch (caught) {
      if (token.current !== id || requestId.current !== req) return
      setSlide(null)
      setFailed(true)
      setNotice(caught instanceof Error ? caught.message : 'Stockfish could not play a move.')
    } finally {
      if (token.current === id && requestId.current === req) setThinking(false)
    }
  }

  function begin(nextSide: Side) {
    const id = ++token.current
    requestId.current += 1
    publishDrag(null)
    setSide(nextSide)
    setSans([])
    setViewPly(0)
    setReviewOnly(false)
    setResigned(false)
    setSourcePgn(null)
    setResult(null)
    setSlide(null)
    setPromotion(null)
    setFailed(false)
    setThinking(false)
    setSaveNote(null)
    setJudgments([])
    setReviewProgress(null)
    resetClocks('w')
    if (nextSide === 'b') {
      setNotice('Stockfish is thinking…')
      void askEngine([], id, nextSide, DEPTH[level])
      return
    }
    setNotice('Your turn.')
  }

  function finishUserMove(from: SquareName, to: SquareName, promotionPiece?: PieceSymbol) {
    const played = replay(sans).move({ from, to, promotion: promotionPiece })
    if (!played) return
    const next = [...sans, played.san]
    setPromotion(null)
    setSans(next)
    setViewPly(next.length)
    setSourcePgn(null)
    setSaveNote(null)
    const done = outcome(replay(next), side, false)
    setResult(done)
    if (done) {
      setNotice(done)
      return
    }
    setNotice('Stockfish is thinking…')
    void askEngine(next, token.current, side, DEPTH[level])
  }

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
      onDraggingChange(false)
      if (!over || over === current.square) return
      const choices = game.moves({ square: current.square as Square, verbose: true }).filter((move) => move.to === over)
      if (choices.length === 0) {
        setNotice('That move is not legal.')
        return
      }
      if (choices.some((move) => move.promotion)) {
        setPromotion({ from: current.square, to: over })
        setNotice('Choose a piece for the pawn.')
        return
      }
      finishUserMove(current.square, over)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  })

  function beginDrag(square: SquareName, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !atLive || thinking || slide || promotion || result) return
    const piece = placement[square]
    if (!piece) return
    const white = piece === piece.toUpperCase()
    if ((side === 'w') !== white || game.turn() !== side) return
    event.preventDefault()
    publishDrag({ square, piece, pointerId: event.pointerId, x: event.clientX, y: event.clientY, over: null })
  }

  function resign() {
    if (result) return
    token.current += 1
    requestId.current += 1
    publishDrag(null)
    setThinking(false)
    setSlide(null)
    setPromotion(null)
    setFailed(false)
    setResigned(true)
    setSaveNote(null)
    const text = 'You resigned. Stockfish wins.'
    setResult(text)
    setNotice(text)
  }

  function applyPgn(pgn: string) {
    const chess = new Chess()
    try {
      chess.loadPgn(pgn)
    } catch {
      setSaveNote('This is not a valid PGN game.')
      return
    }
    const headers = chess.getHeaders()
    const moves = chess.history()
    token.current += 1
    requestId.current += 1
    publishDrag(null)
    setThinking(false)
    setSlide(null)
    setPromotion(null)
    setFailed(false)
    setResigned(false)
    setReviewOnly(true)
    setSourcePgn(pgn)
    setSide(headers.Black === 'You' ? 'b' : 'w')
    setSans(moves)
    setViewPly(0)
    const label = reviewResult(headers, chess)
    setResult(label)
    setNotice(label)
    setSaveNote(null)
    setJudgments([])
    setReviewProgress(moves.length > 0 ? `Checking move 1 of ${moves.length}.` : null)
    resetClocks(null)
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    applyPgn(await file.text())
  }

  async function saveGame() {
    const pgn = sourcePgn ?? buildPgn(sans, side, resigned)
    const white = side === 'w' ? 'you' : 'stockfish'
    const black = side === 'b' ? 'you' : 'stockfish'
    downloadPgn(pgn, `${white}-vs-${black}.pgn`)
    try {
      const stored = await savePgn(pgn)
      setSaved((items) => [stored, ...items.filter((item) => item.id !== stored.id)].slice(0, 12))
      setSaveNote('Saved. The PGN file was downloaded.')
    } catch (caught) {
      setSaveNote(caught instanceof Error ? caught.message : 'The game could not be saved.')
    }
  }

  const rows: { number: number; white: string; black: string }[] = []
  for (let index = 0; index < sans.length; index += 2) {
    rows.push({ number: index / 2 + 1, white: sans[index], black: sans[index + 1] ?? '' })
  }

  const orientation = (side === 'b') !== fromTop ? 'black' : 'white'
  const topSide: Side = orientation === 'white' ? 'b' : 'w'
  const bottomSide: Side = topSide === 'w' ? 'b' : 'w'
  const seat = (color: Side, place: 'top' | 'bottom') => (
    <PlayerSeat
      name={color === side ? 'You' : 'Stockfish'}
      color={color === 'w' ? 'White' : 'Black'}
      ms={spent[color]}
      running={activeSide === color}
      place={place}
    />
  )

  return (
    <div className="play-panel">
      <section className="board-column" aria-label="Game board">
        {seat(topSide, 'top')}
        <Board
          placement={slide ? slide.placement : placement}
          fromSquare={slide ? slide.from : (previous?.from ?? null)}
          toSquare={slide ? slide.to : (previous?.to ?? null)}
          dragFrom={drag?.square ?? null}
          dragOver={drag?.over ?? null}
          flights={slide?.flights ?? []}
          targets={targets}
          orientation={orientation}
          locked={busy}
          onLockedPointerDown={() => {
            if (promotion) {
              setPromotion(null)
              setNotice(yourTurn(game))
            }
          }}
          onDragPiece={beginDrag}
        />
        {seat(bottomSide, 'bottom')}
        {drag && (
          <div className={drag.piece === drag.piece.toUpperCase() ? 'drag-ghost piece white' : 'drag-ghost piece black'} style={{ left: drag.x, top: drag.y }}>
            {PIECE_GLYPHS[drag.piece]}
          </div>
        )}
      </section>

      <aside className="result-column">
        <section className="result-card">
          <h2>Game</h2>
          <div className="turn" role="group" aria-label="Your color">
            <button type="button" aria-pressed={side === 'w'} onClick={() => begin('w')}>
              Play as White
            </button>
            <button type="button" aria-pressed={side === 'b'} onClick={() => begin('b')}>
              Play as Black
            </button>
          </div>
          <div className="turn" role="group" aria-label="Board direction">
            <button type="button" aria-pressed={!fromTop} onClick={() => setFromTop(false)}>
              From the bottom
            </button>
            <button type="button" aria-pressed={fromTop} onClick={() => setFromTop(true)}>
              From the top
            </button>
          </div>
          <div className="turn" role="group" aria-label="Strength">
            {LEVELS.map((item) => (
              <button key={item.id} type="button" aria-pressed={level === item.id} onClick={() => setLevel(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <p className={result && viewPly === sans.length ? 'verdict mate' : 'playback-note'}>{statusText}</p>
          {promotion && (
            <div className="promotion" role="group" aria-label="Promote pawn">
              {PROMOTE.map(({ piece, name }) => {
                const code = (side === 'w' ? piece.toUpperCase() : piece) as PieceCode
                return (
                  <button key={piece} type="button" className={side === 'w' ? 'tray-piece white' : 'tray-piece black'} aria-label={name} onClick={() => finishUserMove(promotion.from, promotion.to, piece)}>
                    {PIECE_GLYPHS[code]}
                  </button>
                )
              })}
            </div>
          )}
          <div className="actions">
            <button type="button" className="secondary" onClick={() => begin(side)}>
              New game
            </button>
            <button type="button" className="secondary" disabled={result !== null} onClick={resign}>
              Resign
            </button>
            <button type="button" className="secondary" disabled={sans.length === 0 || thinking} onClick={() => void saveGame()}>
              Save PGN
            </button>
            <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
              Open PGN
            </button>
            <input ref={fileRef} type="file" accept=".pgn,.txt,text/plain" hidden onChange={(event) => void onFile(event)} />
            {failed && !result && (
              <button type="button" className="analyze" onClick={() => void askEngine(sans, token.current, side, DEPTH[level])}>
                Try again
              </button>
            )}
          </div>
          {saveNote && <p className="playback-note">{saveNote}</p>}
        </section>

        <section className="history">
          <h2>Moves</h2>
          {viewPly > 0 && judgments[viewPly - 1] && <p className="recommendation">{judgmentText(sans[viewPly - 1], judgments[viewPly - 1]!)}</p>}
          {reviewProgress && <p className="playback-note">{reviewProgress}</p>}
          <div className="turn" role="group" aria-label="Replay">
            <button type="button" className="secondary" disabled={viewPly === 0 || thinking} onClick={() => setViewPly(0)}>
              Start
            </button>
            <button type="button" className="secondary" disabled={viewPly === 0 || thinking} onClick={() => setViewPly((ply) => Math.max(0, ply - 1))}>
              Back
            </button>
            <button type="button" className="secondary" disabled={viewPly === sans.length || thinking} onClick={() => setViewPly((ply) => Math.min(sans.length, ply + 1))}>
              Forward
            </button>
            <button type="button" className="secondary" disabled={viewPly === sans.length || thinking} onClick={() => setViewPly(sans.length)}>
              End
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="prompt">Moves will appear here.</p>
          ) : (
            <ol className="score-sheet">
              {rows.map((row) => {
                const whitePly = row.number * 2 - 1
                const blackPly = row.number * 2
                const whiteJudgment = judgments[whitePly - 1]
                const blackJudgment = judgments[blackPly - 1]
                const rowCurrent = viewPly === whitePly || viewPly === blackPly
                return (
                  <li key={row.number} className={rowCurrent ? 'current' : ''} aria-current={rowCurrent ? 'step' : undefined}>
                    <span className="mate-number">{row.number}.</span>
                    <button type="button" className={viewPly === whitePly ? 'current' : ''} onClick={() => setViewPly(whitePly)}>
                      <span>{row.white}</span>
                      {whiteJudgment && <span className={`review-tag ${whiteJudgment.kind}`}>{whiteJudgment.label}</span>}
                    </button>
                    {row.black ? (
                      <button type="button" className={viewPly === blackPly ? 'current' : ''} onClick={() => setViewPly(blackPly)}>
                        <span>{row.black}</span>
                        {blackJudgment && <span className={`review-tag ${blackJudgment.kind}`}>{blackJudgment.label}</span>}
                      </button>
                    ) : (
                      <span />
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <section className="history">
          <h2>Saved games</h2>
          {saved.length === 0 ? (
            <p className="prompt">Saved PGN games appear here.</p>
          ) : (
            <ul>
              {saved.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => applyPgn(item.pgn)}>
                    <span className="history-move">
                      {item.white} vs {item.black}
                    </span>
                    <span className="history-label">{item.result}</span>
                    <span className="history-when">{formatWhen(item.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  )
}
