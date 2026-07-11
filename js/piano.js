/* Piano — tiny sampler over the Salamander Grand Piano
   (Alexander Holm, CC BY 3.0; samples every minor third, C2–C7).
   Nearest sample is repitched with playbackRate, so any note is at
   most one semitone away from a real recording.

   Samples start downloading as soon as the script runs (decoded via an
   OfflineAudioContext, which needs no user gesture). If a play request
   arrives while they are still loading, it waits for them — up to 1.5 s —
   before falling back to the old triangle-wave synth, so the synth is
   only ever heard on a broken or very slow connection.

   API:
     Piano.context()               shared AudioContext (created/resumed lazily)
     Piano.load()                  returns the sample-loading promise
     Piano.play(semis, t0, dur, vol)
       semis: semitones relative to middle C (C4)
       t0:    AudioContext time to start (null = now)
       dur:   seconds before the release begins
       vol:   0..~0.25, same scale the old synth used            */
window.Piano = (function(){
  "use strict";
  const SAMPLE_MIDI = [36,39,42,45,48,51,54,57,60,63,66,69,
                       72,75,78,81,84,87,90,93,96];   // C2..C7
  const NAMES = ["C","Cs","D","Ds","E","F","Fs","G","Gs","A","As","B"];
  const fileOf = m => NAMES[m%12] + (Math.floor(m/12)-1);

  let ctx = null, out = null, loadPromise = null, isReady = false;
  const buffers = {};

  function context(){
    if (!ctx){
      ctx = new (window.AudioContext||window.webkitAudioContext)();
      /* gentle compressor so stacked chord samples don't clip */
      out = ctx.createDynamicsCompressor();
      out.threshold.value = -18; out.knee.value = 12;
      out.ratio.value = 4; out.attack.value = 0.003; out.release.value = 0.25;
      out.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(()=>{});
    return ctx;
  }

  function load(){
    if (loadPromise) return loadPromise;
    /* OfflineAudioContext decodes without a user gesture; the resulting
       AudioBuffers are context-independent and play fine on the real one */
    const dec = new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(1, 1, 44100);
    loadPromise = Promise.all(SAMPLE_MIDI.map(m =>
      fetch("audio/piano/" + fileOf(m) + ".mp3")
        .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(b => dec.decodeAudioData(b))
        .then(buf => { buffers[m] = buf; })
    )).then(()=>{ isReady = true; })
      .catch(err => { console.warn("Piano samples unavailable, staying on synth:", err); });
    return loadPromise;
  }

  function sample(semis, t0, dur, vol){
    const c = context();
    const midi = 60 + Math.round(semis);
    let best = SAMPLE_MIDI[0];
    for (const m of SAMPLE_MIDI)
      if (Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    const src = c.createBufferSource();
    src.buffer = buffers[best];
    src.playbackRate.value = Math.pow(2, (midi - best)/12);
    const g = c.createGain();
    const v = Math.min(1, vol * 3.4);
    g.gain.setValueAtTime(v, t0);
    g.gain.setValueAtTime(v, t0 + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.35);
    src.connect(g).connect(out);
    src.start(t0); src.stop(t0 + dur + 0.4);
  }

  function synth(semis, t0, dur, vol){
    const c = context();
    const o = c.createOscillator(), g = c.createGain();
    o.type = "triangle";
    o.frequency.value = 261.63 * Math.pow(2, semis/12);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function play(semis, t0, dur, vol){
    const c = context();
    if (t0 == null) t0 = c.currentTime + 0.03;
    if (isReady) return sample(semis, t0, dur, vol);
    /* still loading: hold the note until samples arrive (max 1.5 s),
       shifting the scheduled time so sequences keep their spacing */
    const callTime = c.currentTime;
    Promise.race([load(), new Promise(res => setTimeout(res, 1500))]).then(()=>{
      const shifted = t0 + Math.max(0, c.currentTime - callTime);
      (isReady ? sample : synth)(semis, shifted, dur, vol);
    });
  }

  load();   // start fetching immediately — no gesture needed for decode

  return { context, load, play, get ready(){ return isReady; } };
})();
