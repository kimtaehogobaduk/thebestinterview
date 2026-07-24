import { useEffect, useRef } from "react";

interface Props {
  isActive: boolean;
  onSilence3s: () => void;
  onLongRambling: () => void;
  onMumble: () => void;
  onLoudEnough: () => void;
  onLevel?: (level: number) => void;
}

/**
 * Reads mic level via Web Audio and fires callbacks for
 * silence / mumble / long-rambling / normal speech. Non-authoritative;
 * paired with server STT for actual transcription.
 */
export function useAudioReactor({ isActive, onSilence3s, onLongRambling, onMumble, onLoudEnough, onLevel }: Props) {
  const ref = useRef<{
    ctx?: AudioContext;
    analyser?: AnalyserNode;
    src?: MediaStreamAudioSourceNode;
    raf?: number;
    silenceStart?: number;
    speakStart?: number;
    lowLevelStart?: number;
    lastMumble?: number;
    lastRambling?: number;
    lastSilence?: number;
  }>({});

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        ref.current = { ctx, src, analyser };
        const buf = new Uint8Array(analyser.fftSize);

        const tick = () => {
          if (!ref.current.analyser) return;
          ref.current.analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          onLevel?.(rms);
          const now = Date.now();

          if (rms < 0.02) {
            if (!ref.current.silenceStart) ref.current.silenceStart = now;
            if (now - (ref.current.silenceStart ?? now) > 3000 && now - (ref.current.lastSilence ?? 0) > 8000) {
              ref.current.lastSilence = now;
              onSilence3s();
            }
          } else {
            ref.current.silenceStart = undefined;
            if (!ref.current.speakStart) ref.current.speakStart = now;
            if (rms > 0.08) onLoudEnough();
          }

          if (rms > 0.015 && rms < 0.04) {
            if (!ref.current.lowLevelStart) ref.current.lowLevelStart = now;
            if (now - (ref.current.lowLevelStart ?? now) > 4000 && now - (ref.current.lastMumble ?? 0) > 12000) {
              ref.current.lastMumble = now;
              onMumble();
            }
          } else {
            ref.current.lowLevelStart = undefined;
          }

          if (ref.current.speakStart && now - ref.current.speakStart > 25000 && now - (ref.current.lastRambling ?? 0) > 20000) {
            ref.current.lastRambling = now;
            onLongRambling();
          }

          ref.current.raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        console.warn("mic init failed", e);
      }
    })();

    return () => {
      cancelled = true;
      if (ref.current.raf) cancelAnimationFrame(ref.current.raf);
      ref.current.ctx?.close();
      ref.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
}

/**
 * Random-picking, gentle-volume ambient SFX player.
 * Uses WebAudio-synthesized short tones (no external assets).
 */
export function useAmbientSfx() {
  const ctxRef = useRef<AudioContext | null>(null);
  function ctx() {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }
  function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.05) {
    const c = ctx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.02);
    g.gain.linearRampToValueAtTime(0, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur + 0.05);
  }
  function noise(dur: number, gain = 0.04) {
    const c = ctx();
    const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    g.gain.value = gain;
    const filter = c.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2000;
    src.connect(filter).connect(g).connect(c.destination);
    src.start();
  }
  return {
    paperFlip: () => noise(0.3 + Math.random() * 0.2, 0.03),
    sigh: () => tone(180 + Math.random() * 40, 0.6, "sine", 0.04),
    penScribble: () => {
      for (let i = 0; i < 3 + Math.floor(Math.random() * 2); i++)
        setTimeout(() => noise(0.08, 0.025), i * 90);
    },
    throat: () => tone(220, 0.15, "sawtooth", 0.03),
    click: () => tone(1500, 0.03, "square", 0.02),
  };
}
