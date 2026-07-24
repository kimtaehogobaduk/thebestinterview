export type Voice = {
  gender: "male" | "female";
  rate: number; // 0.5–2
  pitch: number; // 0–2
};

const voiceCache: { list: SpeechSynthesisVoice[] } = { list: [] };

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      voiceCache.list = existing;
      resolve(existing);
      return;
    }
    window.speechSynthesis.onvoiceschanged = () => {
      voiceCache.list = window.speechSynthesis.getVoices();
      resolve(voiceCache.list);
    };
  });
}

export async function speak(text: string, v: Voice): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  await loadVoices();
  window.speechSynthesis.cancel();
  const ko = voiceCache.list.filter((x) => x.lang.startsWith("ko"));
  const pool = ko.length ? ko : voiceCache.list;
  const preferred =
    pool.find((x) =>
      v.gender === "female"
        ? /female|woman|여|Yuna|Sora|Heami/i.test(x.name)
        : /male|man|남|InJoon|Minsu/i.test(x.name),
    ) ?? pool[v.gender === "female" ? 0 : Math.min(1, pool.length - 1)];

  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (preferred) u.voice = preferred;
    u.lang = "ko-KR";
    u.rate = v.rate;
    u.pitch = v.pitch;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function cancelSpeak() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
