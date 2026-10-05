---
title: "I built a Mac app that routes all system audio through a DSP chain you design yourself"
published: false
tags: [rust, audio, macos, dsp]
series: "Building Sonir Bench"
---

Sonir Bench is a macOS app that takes every sound your Mac plays, runs it through signal processing you design, and sends the result to your DAC. The beta went live in October 2026.

This post is the overview: what the pieces are and why each one is shaped the way it is. Later posts in this series will dive deep into individual components: million-tap FIR convolution in real time, writing a virtual audio device, keeping the audio thread allocation-free, and so on.

## What it is

Bench installs a virtual audio device. Pick "Sonir Bench" as your output and anything that plays audio (Spotify, Apple Music, Qobuz, a browser tab, a game) lands in Bench. Bench upsamples it to 705.6 kHz or 768 kHz, runs your processing chain, converts it to a rate your DAC accepts, and plays it.

There are three parts:

- **Virtual audio device**: an AudioServerPlugIn written in C, running inside `coreaudiod`
- **Daemon**: a headless Rust process that owns all audio processing and device I/O
- **UI**: Tauri 2 + React 19, in a separate process

![Overview](/images/sonir-bench-macos-dsp-workbench/overview.png)

The UI talks to the daemon over a local WebSocket (JSON-RPC for control, binary frames for telemetry). If the UI crashes, the audio keeps going.

## Why build it

High-end playback software tends to ship dozens of carefully tuned filters, but you pick from a menu; you can't design your own. Filter design tools exist too, but they stop at a file. You export, load it into a player, restart playback, and by then your memory of the previous sound has faded.

Plenty of people can write a windowed sinc. What they can't easily do is:

1. Line up the impulse response, step response and group delay of the filters they designed
2. Switch between them instantly on their own system
3. Tie what they hear back to something they can measure

Bench exists to close that loop: design, look, listen A/B, measure. It doesn't sell "good sound". You decide what good sounds like; Bench is the workbench.

## The entry point: a virtual device of my own

During early development I captured audio through an existing open-source virtual device. Because it is GPLv3, I couldn't bundle it with a commercial app, and the shipping build uses my own AudioServerPlugIn instead.

Owning the device turned out to matter for more than licensing:

- **I choose the advertised sample rates.** It declares both the 44.1 kHz and 48 kHz families up to 192 kHz, so the sending app can play at its native rate and macOS doesn't slip a sample-rate converter in front of Bench
- **It has no volume control.** The device is always at unity gain, so the system volume slider has no path to the captured signal
- **There's no audio IPC.** The plug-in loops its output back to its input stream, and the daemon opens it like any other input device. One audio path, not two

Building it surfaced a class of bugs I now look for everywhere: the screen looks fine while the sound is quietly altered.

One example: if you open a stream at a rate different from the device's current nominal rate, macOS inserts a resampler and says nothing. No error. The daemon now reads the nominal rate directly before opening, and CI fails any code that opens a stream at a requested rate instead of the device's nominal rate.

Another issue: macOS treats input from a virtual device as microphone input. Without microphone permission, Core Audio doesn't return an error; it returns digital silence. Bench reads the permission state and alerts you in the UI, instead of silently staying muted.

## Measuring whether the input is untouched

"Lossless" on the streaming side doesn't mean the app hands over the bits unchanged. When I measured it, Spotify with lossless enabled was not bit-exact at Bench's input. Qobuz, measured the same day, was bit-exact at both CD quality and hi-res.

So Bench doesn't claim "bit-perfect". It measures what arrives and reports it, in two ways.

**Input verification.** You play a reference file in your player, and Bench compares what arrives bit for bit. The file has a sync chirp, a ramp that walks through all 65,536 16-bit codes, a pseudo-random sequence, and a closing chirp in a different band. A match proves there's no resampling, no volume change and no mixing in the path. A mismatch is classified: a constant gain points to app-level volume attenuation, while stretching points to resampling. Right now this runs from the CLI only; it isn't in the UI yet.

**Continuous monitoring.** The input callback inspects each sample as it passes. Integer PCM passed through untouched sits on a fixed grid of values. A volume change makes the grid one step finer; a filter or resampler knocks samples off any valid grid. Bench tallies this per one-second window.

The trap here was silence. Silence sits on every grid, so a naive check reports "bit-perfect" while nothing is playing. Bench gives no verdict until it has enough non-zero samples.

## Why process at 705.6 / 768 kHz

The high internal rate isn't there for the spec sheet. It's there so that naive nonlinear code just works.

Run a signal through `tanh` and you get harmonics that keep going up. At 48 kHz, anything above 24 kHz folds back into the audible band as aliasing. That's why plug-ins for music production oversample 8 to 32 times internally, and why they need anti-aliasing filters to do it.

At 705.6 kHz the Nyquist frequency is 352.8 kHz, so a 1 kHz tone can produce up to its 352nd harmonic before anything folds back. No oversampling filter is needed, so there's no phase shift or ringing from one either. One line of `tanh` is fine here.

The internal rate is decoupled from the output rate. A DAC that tops out at 192 kHz (or 176.4 kHz for the 44.1 kHz family) still gets the benefit: processing happens at 768 kHz or 705.6 kHz respectively, and the signal is decimated once at the very end.

Math is f64 throughout. The rounding floor is about -145 dB for f32 and about -320 dB for f64; the best DACs have a noise floor around -130 dB. I'm not going to market precision beyond that.

## Long FIR filters in real time

In Bench you also design the sample-rate conversion filters yourself: cutoff, transition width and tap count. Whatever you design runs live.

Direct convolution at 705.6 kHz stereo topped out at 757 taps per core, about 1 ms of impulse response. Not enough for resampling or room correction. Bench uses uniformly partitioned FFT convolution (overlap-save) instead. On an Apple M1, a single 1,048,576-tap convolution takes about 36 to 50 percent of one core.

Partitioned convolution normally adds latency equal to the partition length B. Bench sets its internal block size to exactly B, so each incoming block is convolved and returned as the same block. The convolution adds zero latency, and adding taps doesn't add delay.

The block size does set round-trip latency, though. With B = 4,096 the round trip is 8.33 ms on the 48 kHz family and 9.71 ms on the 44.1 kHz family. The current default is B = 16,384 to lower the CPU cost of the resampling filters, which works out to about 24 to 27 ms. You choose, and the current latency is always on screen.

## Check before it plays

A chain you build yourself can hurt your ears or your speakers. It's easy to write a filter that blows up, a stage that outputs DC, or a design that boosts ultrasonic content. So every chain goes through three checks before it makes a sound:

1. **validate**: shape, ranges, finite coefficients, peak gain, and no boost above 25 kHz
2. **simulate**: only for chains with nonlinear stages. Bench runs a sine, a log sweep and band-limited noise through the chain and checks for NaN, peaks, DC and ultrasonic energy
3. **arm**: any chain with nonlinear stages must have a final limiter and a soft start

If any step fails, that chain doesn't play; Bench falls back to passthrough.

Linear chains skip `simulate` because a linear filter can't create frequencies that aren't in its input. How much ultrasonic energy it can produce follows from its magnitude response, computed once from the coefficients. Nonlinear stages do create new frequencies, so you have to run a signal through them to know.

Chains are JSON, and the spec is public at [sonir.app/spec](https://sonir.app/spec/), so you can have an AI write one. There's deliberately no path for an AI to drive the daemon, though. You hand the JSON to Bench yourself, and if validation fails, you paste the result back to the AI. A conversation can't change what's coming out of your speakers without you in the loop.

## A/B listening

You keep two chains loaded, A and B, and switch between them. The switch is a 5 to 10 ms crossfade, with no dropouts.

Louder sounds better in a comparison, so loudness matching is on by default, and the applied correction in dB is always shown. The correction is computed from the chains' coefficients, not by measuring the music. Measuring the music would give a different correction for every track, and the comparison wouldn't be repeatable.

## The line I won't cross: captured audio never goes to a file

Audio captured through the virtual device is never written to a file, in any form. Otherwise Bench would be a stream ripper.

That's enforced by types, not by a setting or a warning. Every audio buffer carries its origin as a type parameter:

```rust
// Two origins: captured from the virtual device, or not
pub struct Owned;
pub struct Captured;

// Only Owned audio can be written to a file
pub trait FileSink {
    type Sample: Sample;
    type Error;
    fn write(&mut self, audio: Audio<'_, Owned, Self::Sample>) -> Result<(), Self::Error>;
}
```

There is no conversion from `Captured` to `Owned`. Mixing two signals yields `Captured` if either side was captured. "You can't write captured audio to a file" is tested as a `compile_fail` doctest: code that tries it must not compile.

Types only protect what's inside the process. The WebSocket to the UI has no field that could carry a waveform at all; it carries levels, spectra and other numbers. Phase spectra and impulse responses are left out too, since an inverse FFT would turn them back into audio.

## What isn't done yet

- No built-in player for local files. Today Bench processes what other apps play
- Input verification isn't in the UI yet (CLI only)
- With default settings, round-trip latency is above my 20 ms target
- macOS on Apple Silicon only
- A companion phone app (Sonir Remote) measures your room for correction, but the full measure-and-send round trip hasn't been verified on real hardware yet

## Try it

Sonir Bench is free during the beta. It runs on Apple Silicon Macs with macOS 13 or later.

https://sonir.app

Next in the series: running a 1,048,576-tap convolution in real time without adding latency.

---

Sonir Bench: https://sonir.app
Author: https://nadai.dev
