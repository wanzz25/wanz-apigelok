const ytdl = require('@distube/ytdl-core');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const os = require('os');
const path = require('path');
const fs = require('fs');

function isValidYoutubeUrl(url) {
  try {
    return !!url && ytdl.validateURL(url);
  } catch (_) {
    return false;
  }
}

function convertStreamToMp3(inputStream, outputPath, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = ffmpegInstaller.path;
    const args = ['-y', '-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', outputPath];
    const child = spawn(ffmpegPath, args);

    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
        reject(new Error('Timeout saat convert ke MP3'));
      }
    }, timeout);

    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));

    inputStream.on('error', (err) => {
      clearTimeout(timer);
      if (!child.killed) child.kill('SIGKILL');
      reject(new Error(`Gagal mengambil stream audio dari Youtube: ${err.message}`));
    });

    inputStream.pipe(child.stdin);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`FFmpeg gagal (kode ${code}): ${stderr.trim()}`));
      resolve(outputPath);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Gagal menjalankan ffmpeg: ${err.message}`));
    });
  });
}

module.exports = {
  name: "Youtube MP3 Downloader",
  desc: "Download audio dari video Youtube dan convert otomatis ke MP3. Full Node.js (tanpa yt-dlp/python), ffmpeg sudah ter-bundle otomatis lewat npm install — tinggal deploy di VPS/Pterodactyl, tidak butuh install apapun lagi di server. Tidak cocok untuk Vercel serverless.",
  category: "Downloader",
  path: "/api/download/youtube?apikey=&url=",
  async run(req, res) {
    const { url, apikey } = req.query;

    if (!apikey || !global.apikey.includes(apikey)) {
      return res.status(401).json({ status: false, error: "Apikey invalid atau tidak terdaftar" });
    }
    if (!isValidYoutubeUrl(url)) {
      return res.status(400).json({ status: false, error: "Parameter 'url' wajib diisi & harus link Youtube yang valid" });
    }

    const tempDir = os.tmpdir();
    const uniqueId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const mp3Path = path.join(tempDir, `yt-${uniqueId}.mp3`);

    try {
      const info = await ytdl.getInfo(url);
      const safeTitle = (info.videoDetails.title || 'youtube-audio').replace(/[\\/:*?"<>|]/g, '').trim() || 'youtube-audio';
      const audioStream = ytdl.downloadFromInfo(info, { quality: 'highestaudio', filter: 'audioonly' });

      await convertStreamToMp3(audioStream, mp3Path);

      res.download(mp3Path, `${safeTitle}.mp3`, () => {
        if (fs.existsSync(mp3Path)) fs.unlink(mp3Path, () => {});
      });
    } catch (error) {
      if (fs.existsSync(mp3Path)) {
        try { fs.unlinkSync(mp3Path); } catch (_) {}
      }
      return res.status(500).json({ status: false, error: "Gagal memproses video Youtube: " + error.message });
    }
  }
};
