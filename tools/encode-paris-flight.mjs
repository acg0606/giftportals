#!/usr/bin/env node
/** Encode only the actual V23 browser JPEGs, retaining CDP timestamp gaps.
 * Usage: node tools/encode-paris-flight.mjs [--check|--runtime] [--overwrite]
 * Optional existing runtimes: --ffmpeg ABSOLUTE_PATH --ffprobe ABSOLUTE_PATH
 * Input and all outputs are bounded to outputs/v23; nothing is downloaded.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'outputs', 'v23');
const frameDir = path.join(outputDir, 'tour-frames');
const recordingPath = path.join(outputDir, 'tour-recording.json');
const videoPath = path.join(outputDir, 'paris-flight-demo.mp4');
const receiptPath = path.join(outputDir, 'paris-flight-demo-receipt.json');
const knownFfmpeg = 'C:/Users/admin/Documents/Codex/2026-09-29/co/work/media-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';
const args = process.argv.slice(2);
const flags = new Set();
const explicit = {};
for (let i = 0; i < args.length; i++) {
  if (['--ffmpeg', '--ffprobe'].includes(args[i])) {
    const name = args[i].slice(2);
    if (!args[i + 1] || !path.isAbsolute(args[i + 1])) throw new Error(`${args[i]} requires an absolute path to an existing runtime`);
    explicit[name] = args[++i];
  } else if (['--check', '--runtime', '--overwrite', '--help'].includes(args[i])) flags.add(args[i]);
  else throw new Error(`Unknown argument: ${args[i]}`);
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exists = async (filename) => fs.stat(filename).then((s) => s.isFile()).catch(() => false);
function assert(condition, message) { if (!condition) throw new Error(message); }
async function runtime(name, fallback) {
  if (explicit[name]) { assert(await exists(explicit[name]), `${name} runtime does not exist`); return explicit[name]; }
  const suffixes = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const filename = path.join(dir, name + suffix);
      if (await exists(filename)) return filename;
    }
  }
  return fallback && await exists(fallback) ? fallback : null;
}
function run(executable, commandArgs, timeout = 600_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, commandArgs, { cwd: outputDir, windowsHide: true, shell: false });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Media tool exceeded the bounded execution time')); }, timeout);
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-2_000_000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2_000_000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
function jpegSize(bytes) {
  assert(bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8, 'Source frame is not a JPEG');
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    assert(bytes[offset++] === 0xff, 'Malformed JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    const size = bytes.readUInt16BE(offset);
    assert(size >= 2 && offset + size <= bytes.length, 'Malformed JPEG segment');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      assert(size >= 8, 'Malformed JPEG dimensions');
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += size;
  }
  throw new Error('JPEG has no supported size marker');
}
async function capture() {
  const recordingStat = await fs.stat(recordingPath);
  assert(recordingStat.size <= 4_000_000, 'Recording metadata exceeds the 4 MB limit');
  const raw = await fs.readFile(recordingPath);
  const metadata = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  assert(Array.isArray(metadata.frames) && metadata.frames.length >= 2 && metadata.frames.length <= 16_000, 'Recording needs 2 to 16000 real frames');
  const resolvedFrameDir = await fs.realpath(frameDir);
  const frames = [], gaps = [];
  let previous = -Infinity, totalBytes = 0, dimensions;
  for (const [index, frame] of metadata.frames.entries()) {
    assert(frame && typeof frame.path === 'string' && path.isAbsolute(frame.path), `Frame ${index} needs an absolute path`);
    const filename = path.basename(frame.path);
    assert(/^[a-zA-Z0-9._-]+\.jpe?g$/i.test(filename), `Frame ${index} has an unsafe JPEG filename`);
    const resolved = await fs.realpath(frame.path);
    assert(path.dirname(resolved).toLowerCase() === resolvedFrameDir.toLowerCase(), `Frame ${index} must be in outputs/v23/tour-frames`);
    const timestamp = frame.timestamp;
    assert(typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= 1e12 && timestamp > previous, `Frame ${index} has an invalid or non-increasing timestamp`);
    if (index) { const gap = timestamp - previous; assert(gap >= 0.001, 'Frame gaps must be at least 1 ms'); gaps.push(gap); }
    previous = timestamp;
    const stat = await fs.stat(resolved);
    assert(stat.isFile() && stat.size > 0 && stat.size <= 8_000_000, `Frame ${index} exceeds the 8 MB JPEG limit`);
    totalBytes += stat.size;
    assert(totalBytes <= 2_147_483_648, 'Source JPEGs exceed the 2 GiB limit');
    const bytes = await fs.readFile(resolved);
    const size = jpegSize(bytes);
    assert(size.width > 0 && size.height > 0 && size.width <= 1280 && size.height <= 720, 'Capture must be at most 1280 x 720; this script does not resize pixels');
    dimensions ??= size;
    assert(size.width === dimensions.width && size.height === dimensions.height, 'All source JPEGs must have the same dimensions');
    frames.push({ path: resolved, file: filename, timestamp, chapter: frame.chapter ?? null, bytes: stat.size, sha256: sha256(bytes) });
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  const endTimestamp = metadata.endTimestamp ?? frames.at(-1).timestamp + medianGap;
  assert(typeof endTimestamp === 'number' && Number.isFinite(endTimestamp) && endTimestamp > frames.at(-1).timestamp, 'endTimestamp must follow the last captured frame');
  const duration = endTimestamp - frames[0].timestamp;
  assert(duration > 0 && duration <= 720, 'Capture timeline must be at most 12 minutes');
  assert(endTimestamp - frames.at(-1).timestamp <= 10, 'Final hold may not exceed 10 seconds');
  return { metadata, frames, dimensions, duration, endTimestamp, medianGap, totalBytes, recordingSha256: sha256(raw), finalHoldMethod: metadata.endTimestamp === undefined ? 'Median observed inter-frame gap; capture end timestamp was not supplied.' : 'Explicit recording endTimestamp in the CDP clock.' };
}
// Inspect the encoded ISO BMFF container when no installed ffprobe exists.
function mp4Probe(buffer) {
  function boxes(start, end) {
    const result = [];
    for (let offset = start; offset < end;) {
      assert(offset + 8 <= end, 'Truncated MP4 box');
      let size = buffer.readUInt32BE(offset), header = 8;
      if (size === 1) { assert(offset + 16 <= end, 'Truncated large MP4 box'); size = Number(buffer.readBigUInt64BE(offset + 8)); header = 16; }
      if (size === 0) size = end - offset;
      assert(Number.isSafeInteger(size) && size >= header && offset + size <= end, 'Invalid MP4 box size');
      result.push({ type: buffer.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + size });
      offset += size;
    }
    return result;
  }
  const children = (box) => boxes(box.start, box.end);
  const one = (list, type) => { const item = list.find((box) => box.type === type); assert(item, `Missing MP4 ${type} box`); return item; };
  function duration(box) {
    const p = box.start, version = buffer[p];
    assert(version === 0 || version === 1, 'Unsupported MP4 duration version');
    const timescale = buffer.readUInt32BE(p + (version ? 20 : 12));
    const ticks = version ? Number(buffer.readBigUInt64BE(p + 24)) : buffer.readUInt32BE(p + 16);
    assert(timescale > 0 && Number.isSafeInteger(ticks), 'Invalid MP4 duration');
    return { seconds: ticks / timescale, timescale, ticks };
  }
  const moov = one(boxes(0, buffer.length), 'moov');
  const movie = children(moov), streams = [];
  for (const track of movie.filter((box) => box.type === 'trak')) {
    const trackChildren = children(track);
    const tkhd = one(trackChildren, 'tkhd');
    const media = children(one(trackChildren, 'mdia'));
    const handler = one(media, 'hdlr');
    const handlerType = buffer.toString('ascii', handler.start + 8, handler.start + 12);
    const stream = { type: handlerType, duration: duration(one(media, 'mdhd')).seconds };
    if (handlerType === 'vide') {
      stream.width = buffer.readUInt32BE(tkhd.end - 8) / 65536;
      stream.height = buffer.readUInt32BE(tkhd.end - 4) / 65536;
      const table = children(one(children(one(media, 'minf')), 'stbl'));
      const sample = one(table, 'stsd');
      stream.codec = buffer.toString('ascii', sample.start + 12, sample.start + 16);
      const sampleEntryStart = sample.start + 8;
      const sampleEntryEnd = sampleEntryStart + buffer.readUInt32BE(sampleEntryStart);
      const avc = one(boxes(sampleEntryStart + 86, sampleEntryEnd), 'avcC');
      stream.h264ProfileIdc = buffer[avc.start + 1];
      stream.h264Level = buffer[avc.start + 3] / 10;
      const stsz = one(table, 'stsz');
      stream.frameCount = buffer.readUInt32BE(stsz.start + 8);
      const stts = one(table, 'stts');
      const count = buffer.readUInt32BE(stts.start + 4);
      assert(count <= 16_001 && stts.start + 8 + count * 8 <= stts.end, 'Invalid MP4 timing table');
      stream.sampleTiming = Array.from({ length: count }, (_, index) => ({ count: buffer.readUInt32BE(stts.start + 8 + index * 8), ticks: buffer.readUInt32BE(stts.start + 12 + index * 8) }));
      stream.timeScale = duration(one(media, 'mdhd')).timescale;
    }
    streams.push(stream);
  }
  return { method: 'Actual MP4 mvhd/mdhd/tkhd/stsd/stsz/stts box readback', duration: duration(one(movie, 'mvhd')).seconds, bytes: buffer.length, streams };
}
async function main() {
  if (flags.has('--help')) { console.log('node tools/encode-paris-flight.mjs [--check|--runtime] [--overwrite] [--ffmpeg ABSOLUTE_PATH] [--ffprobe ABSOLUTE_PATH]'); return; }
  const ffmpeg = await runtime('ffmpeg', knownFfmpeg);
  const ffprobe = await runtime('ffprobe');
  assert(ffmpeg, 'No existing FFmpeg runtime is available; no tools will be installed or downloaded');
  await fs.mkdir(outputDir, { recursive: true });
  const version = await run(ffmpeg, ['-version'], 15_000);
  assert(version.code === 0, 'Existing FFmpeg runtime failed its version check');
  if (flags.has('--runtime')) { console.log(JSON.stringify({ ffmpeg, ffprobe, version: version.stdout.split(/\r?\n/)[0] }, null, 2)); return; }
  const source = await capture();
  if (flags.has('--check')) { console.log(JSON.stringify({ status: 'VALID', frames: source.frames.length, sourceSize: source.dimensions, timelineSeconds: source.duration, ffmpeg, ffprobe, finalHoldMethod: source.finalHoldMethod }, null, 2)); return; }
  assert(flags.has('--overwrite') || !await exists(videoPath), 'Output video already exists; use --overwrite for this owned output');
  const concat = ['ffconcat version 1.0'];
  for (const [index, frame] of source.frames.entries()) {
    const next = source.frames[index + 1]?.timestamp ?? source.endTimestamp;
    concat.push(`file 'tour-frames/${frame.file}'`, 'option framerate 1000', `duration ${(next - frame.timestamp).toFixed(9)}`);
  }
  // The unchanged final JPEG marks the end of its hold. It adds no new scene.
  concat.push(`file 'tour-frames/${source.frames.at(-1).file}'`, 'option framerate 1000');
  await fs.writeFile(path.join(outputDir, 'paris-flight-frames.ffconcat'), `${concat.join('\n')}\n`);
  const temporary = path.join(outputDir, 'paris-flight-demo.partial.mp4');
  const width = Math.ceil(source.dimensions.width / 2) * 2;
  const height = Math.ceil(source.dimensions.height / 2) * 2;
  const command = ['-hide_banner', '-y', '-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '0', '-i', 'paris-flight-frames.ffconcat', '-vf', `pad=${width}:${height}:0:0:color=black,format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-threads', '2', '-bf', '0', '-fps_mode', 'vfr', '-enc_time_base', '1:1000', '-bsf:v', 'h264_metadata=tick_rate=40:fixed_frame_rate_flag=0:level=auto', '-video_track_timescale', '1000000', '-movflags', '+faststart', temporary];
  const encoded = await run(ffmpeg, command);
  await fs.writeFile(path.join(outputDir, 'paris-flight-encode.log'), encoded.stderr);
  assert(encoded.code === 0, `FFmpeg encoding failed: ${encoded.stderr.slice(-2500)}`);
  const size = (await fs.stat(temporary)).size;
  assert(size > 0 && size <= 512_000_000, 'Encoded MP4 exceeds the 512 MB output limit');
  const bytes = await fs.readFile(temporary);
  const container = mp4Probe(bytes);
  const stream = container.streams.find((item) => item.type === 'vide');
  assert(stream && stream.codec === 'avc1' && stream.width === width && stream.height === height, 'Encoded stream is not the expected H.264 capture size');
  assert(container.streams.length === 1, 'Encoded demo must have one video stream and no audio');
  assert(stream.frameCount === source.frames.length + 1, 'Encoder unexpectedly dropped or inserted source frames');
  const packetDurations = stream.sampleTiming.flatMap((item) => Array(item.count).fill(item.ticks / stream.timeScale));
  assert(packetDurations.length === source.frames.length + 1, 'MP4 timing table has an unexpected sample count');
  let actualTime = 0, maxTimestampError = 0;
  for (const [index, frame] of source.frames.entries()) {
    maxTimestampError = Math.max(maxTimestampError, Math.abs(actualTime - (frame.timestamp - source.frames[0].timestamp)));
    actualTime += packetDurations[index];
  }
  assert(maxTimestampError <= 0.0011, 'MP4 timestamps differ from source capture by more than 1.1 ms');
  assert(Math.abs(actualTime - source.duration) <= 0.0011, 'Encoded final hold differs from the derived capture timeline');
  let probe = null;
  if (ffprobe) {
    const result = await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', temporary], 30_000);
    assert(result.code === 0, `ffprobe failed: ${result.stderr}`);
    probe = JSON.parse(result.stdout);
    await fs.writeFile(path.join(outputDir, 'paris-flight-ffprobe.json'), `${JSON.stringify(probe, null, 2)}\n`);
  }
  const decoded = await run(ffmpeg, ['-v', 'error', '-i', temporary, '-an', '-threads', '2', '-fps_mode', 'passthrough', '-enc_time_base', '1:1000000', '-f', 'null', '-']);
  await fs.writeFile(path.join(outputDir, 'paris-flight-decode.log'), decoded.stderr);
  assert(decoded.code === 0 && !decoded.stderr.trim(), `Full MP4 decode failed: ${decoded.stderr.slice(-2500)}`);
  await fs.rename(temporary, videoPath);
  const receipt = {
    status: 'ENCODED_AND_FULLY_DECODED', createdAt: new Date().toISOString(), video: videoPath,
    provenance: 'This silent MP4 encodes actual local browser CDP JPEG screencast frames. Chapter arrivals were selected manually; the recording skips between chapters and does not show the complete 107-second automatic tour. Original CDP timestamp gaps are preserved. No simulated camera, interpolated motion, generated frames, or scene replacement was used. The final unchanged source frame is repeated once solely to mark the final hold.',
    recordingProvenance: source.metadata.provenance ?? null,
    recording: recordingPath, recordingSha256: source.recordingSha256,
    sourceFrames: source.frames.length, sourceBytes: source.totalBytes, sourceSize: source.dimensions,
    encodedSize: { width, height }, pixelTreatment: width === source.dimensions.width && height === source.dimensions.height ? 'No resizing or pixel padding.' : 'Only a one-pixel black pad on an odd source dimension; no scaling.',
    firstCdpTimestamp: source.frames[0].timestamp, lastCdpTimestamp: source.frames.at(-1).timestamp,
    plannedTimelineSeconds: source.duration, finalHoldSeconds: source.endTimestamp - source.frames.at(-1).timestamp,
    finalHoldMethod: source.finalHoldMethod, maxTimestampErrorSeconds: maxTimestampError,
    sourceObservedAverageFps: (source.frames.length - 1) / (source.frames.at(-1).timestamp - source.frames[0].timestamp),
    playbackTiming: 'Variable frame rate from the actual CDP capture. Source frames are held through genuine capture gaps. There is no motion smoothing, forced frame rate, or added intermediate motion.',
    h264TimingMetadata: 'Nominal 20 fps with the H.264 fixed-frame-rate flag disabled; real presentation times come from the MP4 sample table. H.264 level is computed by the existing FFmpeg metadata filter for playback compatibility.',
    audio: 'No audio stream and no recorded narration.', ffmpeg, ffmpegVersion: version.stdout.split(/\r?\n/)[0],
    ffprobe: ffprobe ? { runtime: ffprobe, durationSeconds: Number(probe.format.duration), bytes: Number(probe.format.size) } : { runtime: null, status: 'UNAVAILABLE', note: 'ffprobe is not installed in the inspected runtime locations. Actual container metrics below come from the MP4 itself and the whole file passed an FFmpeg decode.' },
    actual: container, bytes: size, sha256: sha256(bytes), cleanFullDecode: true,
    frameManifest: source.frames,
  };
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, video: videoPath, receipt: receiptPath, frames: source.frames.length, actualDurationSeconds: container.duration, bytes: size, sourceSize: source.dimensions, maxTimestampErrorSeconds: maxTimestampError, ffprobe: receipt.ffprobe.status ?? 'VERIFIED', cleanFullDecode: true }, null, 2));
}
main().catch((error) => { console.error(`Paris capture encode failed: ${error.message}`); process.exitCode = 1; });
