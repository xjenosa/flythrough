// Frame maker: turns one video into the frame sets <fly-through> reads (WebP,
// or AVIF with --format avif), plus manifest.json. Run through
// bin/flythrough.mjs (`flythrough frames`). Needs sharp, and ffmpeg (any
// recent version: -fps_mode from 5.1, -vsync before it): the one FFMPEG_PATH
// names, else the one on PATH, else the ffmpeg-static package when the
// project has it (findFfmpeg). ffprobe is not needed: the video's frame rate
// is read from ffmpeg's own report, its size from the first decoded frame.
//
// Frames are 1-based, zero-padded to 4 digits, more when there are more than
// 9999 (the manifest's `pad` says how many). A cropped set's horizontal centre follows the
// stops' focus x, eased between stops with the same smoothstep the player uses
// (src/math.ts focusAt). Without the newer options (--frames, --from, --to,
// --format) the output must stay what letramy.com's frames were made with:
// same decode, crop, resize and WebP settings.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

export const FRAMES_USAGE = `Usage: flythrough frames <video> --out <folder> [options]

Turns a video into the frame sets <fly-through> plays, plus manifest.json.

Options
  --out <folder>       where to write (required). Must be empty, new, or a
                       folder this command made before (it is then replaced).
  --set name=W         a set W px wide, height from the video (never upscaled).
                       Repeat for more sets. Default: landscape=1600
  --set name=WxH       a cropped set, e.g. an upright phone set portrait=608x1080:
                       full height, cropped around the --stops focus points
  --set name=W@Q       per-set quality (also name=WxH@Q)
  --stops <file.json>  the stops, as the player takes them:
                       [{ "frame": 49, "focus": [x, y] }, ...]
                       (or { "frames": N, "stops": [...] }: N is the count
                       the frame numbers were written for)
                       needed for cropped sets
  --quality <n>        quality, default 75 (WebP) or 50 (AVIF)
  --format <f>         webp (default) or avif: smaller files, slower to make
                       and to decode, Safari from 16.4
  --frames <n>         keep n frames, evenly spread from the first to the
                       last, for a lighter tour
  --fps <n>            or resample to n frames a second; by default every
                       frame of the video is kept
  --from <time>        start here: seconds (12.5) or m:ss (1:05)
  --to <time>          stop here

Needs sharp (npm i -D sharp) and ffmpeg (on your computer, or npm i -D ffmpeg-static).`;

export class UsageError extends Error {}

const FFMPEG_HELP = `flythrough frames needs ffmpeg, and it was not found on this computer.
Add it to this project:   npm install --save-dev ffmpeg-static
Or in one go:             npx -p flythrough -p sharp -p ffmpeg-static flythrough frames <video> --out <folder>
Or install it for the whole computer, then open a new terminal so it is on your PATH:
  Windows: winget install Gyan.FFmpeg
  Mac:     brew install ffmpeg
  Linux:   sudo apt install ffmpeg   (or your distribution's package)
Or set FFMPEG_PATH to an ffmpeg you already have.`;

const SHARP_HELP = `flythrough frames needs sharp (it encodes the frames), and it is not installed.
In your project:   npm install --save-dev sharp
Or in one go:      npx -p flythrough -p sharp flythrough frames <video> --out <folder>`;

// The program's `-version` text, or null when nothing runs under that name.
function versionOf(program) {
  const r = spawnSync(program, ['-version'], { encoding: 'utf8' });
  return r.error || r.status !== 0 ? null : r.stdout || '';
}

// Which ffmpeg to run: the one FFMPEG_PATH names, else `ffmpeg` on the PATH,
// else the binary the ffmpeg-static package brings, when the project (or the
// npx call) has it. `run` and `load` are passed in by the tests.
export async function findFfmpeg({ env = process.env, run = versionOf, load = () => import('ffmpeg-static') } = {}) {
  if (env.FFMPEG_PATH) {
    const version = run(env.FFMPEG_PATH);
    if (version === null) throw new UsageError(`FFMPEG_PATH is ${env.FFMPEG_PATH}, but no ffmpeg runs from there.`);
    return { program: env.FFMPEG_PATH, version, from: 'FFMPEG_PATH' };
  }
  const onPath = run('ffmpeg');
  if (onPath !== null) return { program: 'ffmpeg', version: onPath, from: 'PATH' };
  let bundled = null;
  try {
    bundled = (await load()).default;
  } catch {}
  const version = bundled ? run(bundled) : null;
  if (version === null) throw new UsageError(FFMPEG_HELP);
  return { program: bundled, version, from: 'ffmpeg-static' };
}

// The flag that keeps every decoded frame as it is: -fps_mode since ffmpeg
// 5.1, -vsync before it. A version that does not parse (a git
// build, "N-12345-g...") is taken as new.
export function passthroughFlag(versionText) {
  const m = /version\s+n?(\d+)\.(\d+)/.exec(versionText);
  if (!m) return ['-fps_mode', 'passthrough'];
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 5 || (major === 5 && minor >= 1) ? ['-fps_mode', 'passthrough'] : ['-vsync', 'passthrough'];
}

// The video's frame rate, from what ffmpeg prints about its input: "tbr"
// (the rate ffprobe calls r_frame_rate), else "fps". ffmpeg rounds to two
// places, so the broadcast rates get their exact value back. null when the
// line is not there.
export function frameRate(report) {
  const line = /Stream #0[^\n]*Video:[^\n]*/.exec(report)?.[0] ?? '';
  const m = /(\d+(?:\.\d+)?) tbr/.exec(line) ?? /(\d+(?:\.\d+)?) fps/.exec(line);
  if (!m) return null;
  const rate = Number(m[1]);
  const exact = { 23.98: 24000 / 1001, 29.97: 30000 / 1001, 59.94: 60000 / 1001 }[rate];
  return exact ?? (rate > 0 ? rate : null);
}

// "12.5", "1:05" or "1:02:03.5", as seconds; NaN for anything else.
export function seconds(text) {
  if (!/^(\d+:){0,2}\d+(\.\d+)?$/.test(text)) return NaN;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

// Which of `total` decoded frames to keep for --frames n: n of them, evenly
// spread, always the first and the last (a stop can sit on either). Never
// more than there are.
export function pickFrames(total, n) {
  if (!n || n >= total) return Array.from({ length: total }, (_, i) => i);
  return Array.from({ length: n }, (_, i) => Math.round((i * (total - 1)) / (n - 1)));
}

// Digits in a frame's file name: 4, or more for over 9999 frames, so names
// sort in playing order.
export function padFor(frames) {
  return Math.max(4, String(frames).length);
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch (err) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')) throw new UsageError(SHARP_HELP);
    throw err;
  }
}

export function parseFramesArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        set: { type: 'string', multiple: true },
        stops: { type: 'string' },
        quality: { type: 'string' },
        format: { type: 'string' },
        frames: { type: 'string' },
        fps: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    throw new UsageError(`${err.message}\n\n${FRAMES_USAGE}`);
  }
  const { values: v, positionals } = parsed;
  if (v.help) return { help: true };
  if (positionals.length !== 1) throw new UsageError(FRAMES_USAGE);
  if (!v.out) throw new UsageError(`--out is required.\n\n${FRAMES_USAGE}`);
  const num = (name, s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${name} must be a positive number, not "${s}"`);
    return n;
  };
  const format = v.format ?? 'webp';
  if (format !== 'webp' && format !== 'avif') throw new UsageError(`--format must be webp or avif, not "${format}"`);
  const quality = v.quality === undefined ? (format === 'avif' ? 50 : 75) : num('quality', v.quality);
  const time = (name, s) => {
    if (s === undefined) return null;
    const t = seconds(s);
    if (!Number.isFinite(t)) throw new UsageError(`--${name} must be a time in seconds (12.5) or m:ss (1:05), not "${s}"`);
    return t;
  };
  const from = time('from', v.from);
  const to = time('to', v.to);
  if (to !== null && to <= (from ?? 0)) throw new UsageError('--to must be later than --from');
  if (v.frames !== undefined && v.fps !== undefined) throw new UsageError('use --frames or --fps, not both');
  const frames = v.frames === undefined ? null : num('frames', v.frames);
  if (frames !== null && (!Number.isInteger(frames) || frames < 2)) {
    throw new UsageError(`--frames must be a whole number, 2 or more, not "${v.frames}"`);
  }
  const sets = (v.set ?? []).map((s) => {
    const m = /^([\w-]+)=(\d+)(?:x(\d+))?(?:@(\d+))?$/.exec(s);
    if (!m) throw new UsageError(`bad --set "${s}": use name=W, name=WxH, optionally @quality`);
    return { name: m[1], width: Number(m[2]), height: m[3] ? Number(m[3]) : null, quality: m[4] ? Number(m[4]) : quality };
  });
  if (sets.length === 0) sets.push({ name: 'landscape', width: 1600, height: null, quality });
  if (new Set(sets.map((s) => s.name)).size !== sets.length) throw new UsageError('each --set needs its own name');
  if (sets.some((s) => s.height) && !v.stops) throw new UsageError('cropped sets (name=WxH) need --stops for their focus points');
  return {
    input: positionals[0],
    out: v.out,
    sets,
    stopsFile: v.stops ?? null,
    fps: v.fps === undefined ? null : num('fps', v.fps),
    format,
    frames,
    from,
    to,
  };
}

// Clears what a previous run wrote (manifest.json and its set folders) and
// nothing else. A folder with other files in it is refused: --out once named
// a project folder by mistake would otherwise be wiped.
export function prepareOut(out, setNames) {
  if (!existsSync(out)) return mkdirSync(out, { recursive: true });
  if (!statSync(out).isDirectory()) throw new UsageError(`--out ${out} is a file, not a folder`);
  const entries = readdirSync(out);
  if (entries.length === 0) return;
  const manifestPath = path.join(out, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new UsageError(`--out ${out} already has files in it and no manifest.json, so it was not made by this command. Choose an empty or new folder.`);
  }
  let old = {};
  try {
    old = JSON.parse(readFileSync(manifestPath, 'utf8')).sets ?? {};
  } catch {}
  const dirs = new Set(setNames);
  for (const s of Object.values(old)) {
    const dir = typeof s?.pattern === 'string' ? s.pattern.split('/')[0] : '';
    if (/^[\w-]+$/.test(dir)) dirs.add(dir);
  }
  for (const d of dirs) rmSync(path.join(out, d), { recursive: true, force: true });
  rmSync(manifestPath, { force: true });
}

// The --stops file: the stops as the player takes them (a list; each stop
// placed by `frame`, from 1, by `time` in seconds or by `at`, 0 to 1), or
// { "frames": N, "stops": [...] }, where N is the frame count the frame
// numbers were written for. Says what is wrong with the file by name.
export function readStops(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new UsageError(`--stops ${file} is not JSON: ${err.message}`);
  }
  const stops = Array.isArray(data) ? data : data?.stops;
  const shape = '[{ "frame": 49, "focus": [0.5, 0.5] }, ...]';
  if (!Array.isArray(stops) || !stops.length) throw new UsageError(`--stops ${file} holds no stops. It is a list of them: ${shape}`);
  const frames = Array.isArray(data) ? undefined : data.frames;
  if (frames !== undefined && (!Number.isInteger(frames) || frames < 2)) throw new UsageError(`--stops ${file}: "frames" must be a whole number, 2 or more`);
  stops.forEach((s, k) => {
    const place = s?.frame ?? s?.time ?? s?.at;
    if (typeof place !== 'number' || !Number.isFinite(place)) {
      throw new UsageError(`--stops ${file}: stop ${k + 1}${s?.id ? ` ("${s.id}")` : ''} has no place. Give it "frame" (from 1), "time" (seconds) or "at" (0 to 1): ${shape}`);
    }
  });
  return { frames: frames ?? null, stops };
}

// Each stop's place as 0..1 of the footage made here (n frames at fps a
// second). A frame number counts the file's own "frames" when it gives one.
function stopShares(flight, n, fps) {
  const share = (s) => (s.frame !== undefined ? (s.frame - 1) / ((flight.frames ?? n) - 1) : s.time !== undefined ? (s.time * fps) / (n - 1) : s.at);
  return flight.stops.map((s) => Math.min(1, Math.max(0, share(s))));
}

function focusPath(flight, n, fps) {
  const at = stopShares(flight, n, fps);
  const pts = flight.stops.map((s, k) => ({ at: at[k], x: s.focus?.[0] ?? 0.5 })).sort((a, b) => a.at - b.at);
  const smooth = (t) => t * t * (3 - 2 * t);
  return (p) => {
    if (p <= pts[0].at) return pts[0].x;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (p <= b.at) return a.x + (b.x - a.x) * smooth((p - a.at) / (b.at - a.at || 1));
    }
    return pts[pts.length - 1].x;
  };
}

// The closing report: what was made and what it weighs, in the words a site
// owner needs. sets: [{ name, width, height, format, quality, bytes }].
// The loading screen waits for about one frame in eight and a second either
// side of where the player opens (readyOrder in src/math.ts). firstStop: the
// first stop's frame (1-based) when known, for the poster.
export function report({ sets, frames, fps, manifestPath, firstStop }) {
  const mb = (bytes) => (bytes < 1048576 ? `${Math.round(bytes / 1024)} kB` : `${(bytes / 1048576).toFixed(1)} MB`);
  const first = Math.min(frames, Math.ceil(frames / 8) + 2 * Math.round(fps));
  const wide = Math.max(...sets.map((s) => s.name.length));
  const lines = [`[frames] ${frames} frames at ${Number(fps.toFixed(2))} a second (${Number((frames / fps).toFixed(1))} s of footage)`];
  for (const s of sets) {
    const each = s.bytes / frames;
    const size = `${s.width}x${s.height}`.padEnd(9);
    lines.push(
      `  ${s.name.padEnd(wide)}  ${size}  ${s.format} q${s.quality}  ${mb(s.bytes).padStart(8)} in all, ${(each / 1024).toFixed(1)} kB a frame; the loading screen waits for about ${mb(each * first)}`,
    );
  }
  lines.push(sets.length > 1 ? '  A visitor downloads one set, the one that fits their screen.' : '  A visitor downloads the set as they scroll.');
  if (sets.some((s) => s.bytes > 40 * 1048576)) {
    lines.push('  That is heavy for a phone. A lower --quality, a smaller width or --frames <n> makes it lighter.');
  }
  const pad = padFor(frames);
  const file = (n) => `${sets[0].name}/${String(n).padStart(pad, '0')}.${sets[0].format}`;
  lines.push(
    firstStop
      ? `  Poster (the frame the player opens on): ${file(firstStop)}, or ${file(1)} with intro`
      : `  Poster (the frame the player opens on): the first stop's frame, or ${file(1)} with intro`,
  );
  lines.push(`  Manifest: ${manifestPath}`);
  return lines;
}

export async function makeFrames(argv, log = console.log) {
  const opts = parseFramesArgs(argv);
  if (opts.help) return log(FRAMES_USAGE);
  const { input, out, sets, stopsFile, format } = opts;
  if (!existsSync(input)) throw new UsageError(`video not found: ${input}`);
  if (stopsFile && !existsSync(stopsFile)) throw new UsageError(`--stops file not found: ${stopsFile}`);
  const ffmpeg = await findFfmpeg();
  const sharp = await loadSharp();
  const flight = stopsFile ? readStops(stopsFile) : null;

  prepareOut(out, sets.map((s) => s.name));

  // 1. Decode once to near-lossless JPEGs. What ffmpeg reports (stderr)
  // carries the video's frame rate.
  const tmp = mkdtempSync(path.join(tmpdir(), 'flythrough-frames-'));
  try {
    const filters = [];
    if (opts.from !== null || opts.to !== null) {
      const span = [opts.from !== null && `start=${opts.from}`, opts.to !== null && `end=${opts.to}`].filter(Boolean).join(':');
      filters.push(`trim=${span}`, 'setpts=PTS-STARTPTS');
    }
    if (opts.fps) filters.push(`fps=${opts.fps}`);
    log(`[frames] reading ${input}${ffmpeg.from === 'PATH' ? '' : ` (ffmpeg from ${ffmpeg.from})`}`);
    const dec = spawnSync(ffmpeg.program, [
      '-hide_banner', '-nostats', '-y', '-i', input,
      ...(filters.length ? ['-vf', filters.join(',')] : []),
      ...passthroughFlag(ffmpeg.version), '-q:v', '1', path.join(tmp, '%08d.jpg'),
    ], { encoding: 'utf8', maxBuffer: 64 * 1048576 });
    const said = dec.stderr || '';
    if (dec.status !== 0) {
      const why = said.trim().split('\n').slice(-3).join('\n');
      throw new UsageError(`ffmpeg could not read ${input}${why ? `:\n${why}` : ''}`);
    }
    const decoded = readdirSync(tmp).filter((f) => f.endsWith('.jpg')).sort();
    if (!decoded.length) throw new UsageError(`ffmpeg found no frames in ${input}`);
    if (opts.frames && opts.frames >= decoded.length) {
      log(`[frames] --frames ${opts.frames}: the video has ${decoded.length} frames, so all are kept`);
    }
    const files = pickFrames(decoded.length, opts.frames).map((i) => decoded[i]);
    const n = files.length;
    const meta = await sharp(path.join(tmp, files[0])).metadata();
    const srcW = meta.width;
    const srcH = meta.height;
    const srcFps = frameRate(said);
    if (!opts.fps && !srcFps) log('[frames] could not read the frame rate of the video; taking 24 a second (set it with --fps)');
    // The rate the kept frames play at: thinned by --frames, it drops with them.
    const fps = ((opts.fps ?? srcFps ?? 24) * n) / decoded.length;
    log(`[frames] ${srcW}x${srcH}${srcFps ? `, ${Number(srcFps.toFixed(3))} frames a second` : ''}: ${decoded.length} frames${n < decoded.length ? `, keeping ${n}` : ''}`);
    const pad = padFor(n);
    const name = (i) => `${String(i + 1).padStart(pad, '0')}.${format}`;
    const focusAt = sets.some((s) => s.height) ? focusPath(flight, n, fps) : () => 0.5;

    // 2. Encode every set. version: the manifest format (src/manifest.ts).
    const manifest = { version: 1, fps: Number(fps.toFixed(3)), duration: Number((n / fps).toFixed(3)), frames: n, sets: {} };
    const made = [];
    for (const set of sets) {
      const dir = path.join(out, set.name);
      mkdirSync(dir, { recursive: true });
      let outW;
      let outH;
      if (set.height) {
        outW = set.width;
        outH = set.height;
      } else {
        outW = Math.min(set.width, srcW);
        outH = Math.round((outW * srcH) / srcW / 2) * 2;
      }
      const cropW = set.height ? Math.min(srcW, Math.round((srcH * set.width) / set.height)) : srcW;
      let bytes = 0;
      let cursor = 0;
      let done = 0;
      let tenths = 0;
      const work = async () => {
        while (cursor < n) {
          const i = cursor++;
          let img = sharp(path.join(tmp, files[i]));
          if (set.height) {
            const p = n > 1 ? i / (n - 1) : 0;
            const left = Math.max(0, Math.min(srcW - cropW, Math.round(focusAt(p) * srcW - cropW / 2)));
            img = img.extract({ left, top: 0, width: cropW, height: srcH });
          }
          img = img.resize({ width: outW, height: outH, fit: 'fill' });
          img = format === 'avif' ? img.avif({ quality: set.quality, effort: 4 }) : img.webp({ quality: set.quality, effort: 5 });
          const info = await img.toFile(path.join(dir, name(i)));
          bytes += info.size;
          // A line every tenth of the way, for sets long enough to wait on.
          const tenth = Math.floor((++done * 10) / n);
          if (n >= 200 && tenth > tenths && tenth < 10) {
            tenths = tenth;
            log(`[frames] ${set.name}: ${tenth * 10}%`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.max(2, cpus().length - 1) }, work));
      manifest.sets[set.name] = {
        width: outW,
        height: outH,
        pattern: `${set.name}/{i}.${format}`,
        pad,
        ...(set.height ? { cropped: true } : {}),
      };
      made.push({ name: set.name, width: outW, height: outH, format, quality: set.quality, bytes });
    }
    const manifestPath = path.join(out, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    // The first stop's frame among the frames made here.
    const firstStop = flight && n > 1 ? Math.round(Math.min(...stopShares(flight, n, fps)) * (n - 1)) + 1 : null;
    for (const line of report({ sets: made, frames: n, fps, manifestPath, firstStop })) log(line);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
