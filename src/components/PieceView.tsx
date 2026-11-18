import { PIECE_GLYPHS, type PieceCode } from '../position'
import { useBoardStyle } from '../boardStyle'

export function PieceView({ code }: { code: PieceCode }) {
  const { style } = useBoardStyle()
  if (style !== 'default') {
    const side = code === code.toUpperCase() ? 'w' : 'b'
    return <img src={`/pieces/${style}/${side}/${code}.png`} alt="" draggable={false} />
  }
  return PIECE_GLYPHS[code]
}
