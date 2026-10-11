import { buyerLines, type FeeBreakdown } from '@/lib/domain/fees';
import { formatPence } from '@/lib/format';

/** The buyer's price breakdown: every charge on its own line, then the total. */
export function FeeLines({ quote, caption = 'What you pay' }: { quote: FeeBreakdown; caption?: string }) {
  return (
    <table className="pv-fees">
      <caption className="pv-visually-hidden">{caption}</caption>
      <tbody>
        {buyerLines(quote).map((l) => (
          <tr key={l.key}>
            <th scope="row">
              {l.label}
              {l.note ? <span className="pv-note">{l.note}</span> : null}
            </th>
            <td>{l.pence < 0 ? `−${formatPence(-l.pence)}` : formatPence(l.pence)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          <td>{formatPence(quote.buyerTotalPence)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
