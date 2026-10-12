// Cek manual downloader YouTube: yt-dlp terdeteksi, metadata terbaca,
// audio & video bisa diunduh.
//   node scripts/ytdlp-check.mjs [url]
import * as media from '../lib/media.js';
import { audioExtension } from '../plugins/downloader-ytmp3.js';

const url = process.argv[2] || 'https://www.youtube.com/watch?v=BaW_jenozKc'; // video uji resmi yt-dlp (~10 detik)

console.log('Kandidat yt-dlp :', JSON.stringify(media.resolveYtDlp('', { refresh: true })));
console.log('ffmpeg tersedia :', media.hasFfmpeg());
console.log('URL uji         :', url);

try {
  const info = await media.ytDlpInfo(url);
  console.log('INFO  ✅        :', JSON.stringify(info));
} catch (err) {
  console.log('INFO  ❌        :', err.message);
}

try {
  const audio = await media.ytDlpDownload(url, { format: 'audio', checkDuration: false, timeout: 150000 });
  console.log('AUDIO ✅        :', audio.length, 'bytes | ekstensi:', audioExtension(audio));
} catch (err) {
  console.log('AUDIO ❌        :', err.message);
}

try {
  const video = await media.ytDlpDownload(url, { format: 'video', height: 720, checkDuration: false, timeout: 150000 });
  console.log('VIDEO ✅        :', video.length, 'bytes | container:', video.subarray(4, 8).toString());
} catch (err) {
  console.log('VIDEO ❌        :', err.message);
}
