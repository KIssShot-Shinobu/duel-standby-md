/**
 * Quote random (data lokal, tanpa API).
 *   .quote
 */
import { pickRandom } from '../lib/functions.js';

const QUOTES = [
  ['Jangan menunggu waktu luang, luangkan waktunya.', 'Anonim'],
  ['Kegagalan adalah bumbu, bukan hidangan utama.', 'Anonim'],
  ['Orang yang berhenti belajar akan jadi tua, yang terus belajar tetap muda.', 'Henry Ford'],
  ['Kesuksesan bukan akhir, kegagalan bukan hal fatal.', 'Winston Churchill'],
  ['Lakukan yang bisa kamu lakukan, dengan apa yang kamu punya, di mana kamu berada.', 'Theodore Roosevelt'],
  ['Hidup itu sederhana, kita yang membuatnya rumit.', 'Confucius'],
  ['Barang siapa bersungguh-sungguh, pasti akan menemukan jalan.', 'Pepatah'],
  ['Ilmu tanpa amal seperti pohon tanpa buah.', 'Pepatah Arab'],
  ['Berpikir tanpa bertindak hanyalah mimpi siang bolong.', 'Anonim'],
  ['Rezeki tidak akan tertukar, tapi ikhtiar tetap wajib.', 'Anonim'],
];

const handler = async (m) => {
  const [text, author] = pickRandom(QUOTES);
  return m.reply(`💬 _"${text}"_\n\n— *${author}*`);
};

handler.help = ['quote', 'quotes'];
handler.tags = ['fun'];
handler.command = /^(quote|quotes|katabijak)$/i;
handler.limit = false;

export default handler;
