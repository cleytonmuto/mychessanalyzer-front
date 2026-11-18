import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { listRobotSessions, reviewPosition, sendRobotCommand, type RobotSession, type RobotSide } from '../api'
import { parseFen } from '../position'
import Board from './Board'

type Level = 'easy' | 'medium' | 'strong'

const DEPTH: Record<Level, number> = { easy: 6, medium: 10, strong: 16 }

const LEVELS: { id: Level; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'strong', label: 'Strong' },
]

function colorLabel(side: RobotSide): string {
  return side === 'w' ? 'White' : 'Black'
}

function orientationFor(side: RobotSide, fromTop: boolean): 'white' | 'black' {
  return (side === 'b') !== fromTop ? 'black' : 'white'
}

function lastSquares(sans: string[]): { from: string | null; to: string | null } {
  const chess = new Chess()
  let from: string | null = null
  let to: string | null = null
  for (const san of sans) {
    try {
      const move = chess.move(san)
      from = move.from
      to = move.to
    } catch {
      break
    }
  }
  return { from, to }
}

function windowLabel(session: RobotSession, index: number): string {
  const place = session.from_top ? 'from the top' : 'from the bottom'
  return `Window ${index + 1} · Robot ${colorLabel(session.side)} ${place}`
}

export default function RobotGame({ active }: { active: boolean }) {
  const pendingFen = useRef<string | null>(null)
  const attempt = useRef<{ fen: string; level: Level; sent: boolean; cancel: boolean } | null>(null)
  const [sessions, setSessions] = useState<RobotSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [robotSide, setRobotSide] = useState<RobotSide>('w')
  const [fromTop, setFromTop] = useState(false)
  const [level, setLevel] = useState<Level>('medium')
  const [auto, setAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('Open Play in any browser and choose that window here.')
  const [listError, setListError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  const selected = sessions.find((session) => session.id === selectedId) ?? null
  const previewOrientation = selected ? selected.orientation : orientationFor(robotSide, fromTop)
  const previewFen = selected?.fen ?? new Chess().fen()
  const squares = lastSquares(selected?.sans ?? [])
  const placement = parseFen(previewFen).placement
  const topColor: RobotSide = previewOrientation === 'white' ? 'b' : 'w'
  const bottomColor: RobotSide = topColor === 'w' ? 'b' : 'w'
  const playedSide = selected?.side ?? robotSide

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async () => {
      try {
        const next = await listRobotSessions()
        if (cancelled) return
        setSessions(next)
        setListError(null)
      } catch (caught) {
        if (cancelled) return
        setListError(caught instanceof Error ? caught.message : 'Play windows could not be listed.')
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 800)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active])

  useEffect(() => {
    if (!active || !auto || !selected?.your_turn || selected.result) return
    const fen = selected.fen
    const id = selected.id
    const current = attempt.current
    if (current && current.fen === fen && current.level === level && !current.cancel) return
    if (current) current.cancel = true
    const job = { fen, level, sent: false, cancel: false }
    attempt.current = job
    void (async () => {
      try {
        setNote('Choosing the next move…')
        const reply = await reviewPosition(fen, DEPTH[level])
        if (job.cancel || attempt.current !== job) return
        if (!reply.best_move_san) throw new Error('Stockfish did not return a move.')
        setNote('Sending the move…')
        await sendRobotCommand(id, { kind: 'move', san: reply.best_move_san })
        job.sent = true
        setNote(`Sent ${reply.best_move_san}.`)
      } catch (caught) {
        if (job.cancel || attempt.current !== job) return
        attempt.current = null
        setNote(caught instanceof Error ? caught.message : 'The move could not be sent.')
        window.setTimeout(() => setRetry((value) => value + 1), 1500)
      }
    })()
    return () => {
      job.cancel = true
    }
  }, [active, auto, selected?.id, selected?.fen, selected?.your_turn, selected?.result, level, retry])

  useEffect(() => {
    if (!active || !auto || !selected?.your_turn || !attempt.current?.sent) return
    if (attempt.current.fen !== selected.fen) return
    const fen = selected.fen
    const timer = window.setTimeout(() => {
      if (attempt.current?.fen === fen && attempt.current.sent) {
        attempt.current = null
        setRetry((value) => value + 1)
      }
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [active, auto, selected?.fen, selected?.your_turn, retry])

  async function startGame() {
    if (!selected) return
    setNote('Starting the game in the selected window…')
    try {
      await sendRobotCommand(selected.id, { kind: 'start', side: robotSide, from_top: fromTop })
      pendingFen.current = null
      attempt.current = null
      setRetry((value) => value + 1)
      setNote(`The robot plays ${colorLabel(robotSide)} ${fromTop ? 'from the top' : 'from the bottom'}.`)
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'The game could not be started.')
    }
  }

  async function sendMove(snapshot: RobotSession) {
    if (busy || !snapshot.your_turn) return
    pendingFen.current = snapshot.fen
    if (attempt.current) attempt.current.cancel = true
    const job = { fen: snapshot.fen, level, sent: false, cancel: false }
    attempt.current = job
    setBusy(true)
    setNote('Choosing your move…')
    try {
      const reply = await reviewPosition(snapshot.fen, DEPTH[level])
      if (!reply.best_move_san) throw new Error('Stockfish did not return a move.')
      await sendRobotCommand(snapshot.id, { kind: 'move', san: reply.best_move_san })
      job.sent = true
      setNote(`Sent ${reply.best_move_san} to window ${snapshot.id}.`)
    } catch (caught) {
      pendingFen.current = null
      if (attempt.current === job) attempt.current = null
      setNote(caught instanceof Error ? caught.message : 'The move could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  const rows: { number: number; white: string; black: string }[] = []
  for (let index = 0; index < (selected?.sans.length ?? 0); index += 2) {
    rows.push({ number: index / 2 + 1, white: selected!.sans[index], black: selected!.sans[index + 1] ?? '' })
  }

  return (
    <div className="play-panel">
      <section className="board-column" aria-label="Robot board">
        <p className="player-seat">
          <span className="player-name">{topColor === playedSide ? 'Robot' : 'Stockfish'}</span>
          <span className="player-color">{colorLabel(topColor)}</span>
        </p>
        <Board
          placement={placement}
          fromSquare={squares.from}
          toSquare={squares.to}
          dragFrom={null}
          dragOver={null}
          flights={[]}
          orientation={previewOrientation}
          locked
          onDragPiece={() => {}}
          onLockedPointerDown={() => {}}
        />
        <p className="player-seat">
          <span className="player-name">{bottomColor === playedSide ? 'Robot' : 'Stockfish'}</span>
          <span className="player-color">{colorLabel(bottomColor)}</span>
        </p>
      </section>

      <aside className="result-column">
        <section className="result-card">
          <h2>Setup</h2>
          <p className="playback-note">Choose the Play window, even if it is open in another browser. Then choose the colors and which side sits at the bottom.</p>
          <p className="playback-note">Duolingo matches and chess.com computer games are played by the Chrome extension in mychessanalyzer-extension. Keep the analyzer API running and the extension can play with Cursor closed.</p>
          <div className="turn" role="group" aria-label="Robot color">
            <button type="button" aria-pressed={robotSide === 'w'} onClick={() => setRobotSide('w')}>
              Robot plays White
            </button>
            <button type="button" aria-pressed={robotSide === 'b'} onClick={() => setRobotSide('b')}>
              Robot plays Black
            </button>
          </div>
          <div className="turn" role="group" aria-label="Stockfish color">
            <button type="button" aria-pressed={robotSide === 'b'} onClick={() => setRobotSide('b')}>
              Stockfish plays White
            </button>
            <button type="button" aria-pressed={robotSide === 'w'} onClick={() => setRobotSide('w')}>
              Stockfish plays Black
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
          <div className="actions">
            <button type="button" className="analyze" disabled={!selected} onClick={() => void startGame()}>
              Start game
            </button>
            <button type="button" className="secondary" disabled={!selected?.your_turn || busy} onClick={() => selected && void sendMove(selected)}>
              {busy ? 'Choosing…' : 'Play my move'}
            </button>
          </div>
          <div className="turn" role="group" aria-label="Robot strength">
            {LEVELS.map((item) => (
              <button key={item.id} type="button" aria-pressed={level === item.id} onClick={() => setLevel(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <label className="robot-auto">
            <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
            Keep playing my moves
          </label>
          <p className={selected?.result ? 'verdict mate' : 'playback-note'}>{selected?.notice || note}</p>
          {selected && note && <p className="playback-note">{note}</p>}
          {listError && <p className="playback-note">{listError}</p>}
        </section>

        <section className="history">
          <h2>Play windows</h2>
          {sessions.length === 0 ? (
            <p className="prompt">No Play window is connected. Open Play in Chrome, Firefox, or another browser.</p>
          ) : (
            <ul>
              {sessions.map((session, index) => (
                <li key={session.id}>
                  <button type="button" className={selectedId === session.id ? 'current' : ''} onClick={() => setSelectedId(session.id)}>
                    <span className="history-move">{windowLabel(session, index)}</span>
                    <span className="history-label">{session.your_turn ? 'Robot to move' : session.thinking ? 'Stockfish is thinking' : (session.result ?? session.notice)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="history">
          <h2>Moves</h2>
          {rows.length === 0 ? (
            <p className="prompt">Moves from the selected window appear here.</p>
          ) : (
            <ol className="score-sheet">
              {rows.map((row) => (
                <li key={row.number}>
                  <span className="mate-number">{row.number}.</span>
                  <span>{row.white}</span>
                  <span>{row.black}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  )
}
