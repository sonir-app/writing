---
title: "A million-tap linear-phase FIR in real time: 7 ms of plumbing, 650 ms of filter"
published: true
tags: [rust, audio, dsp, performance]
series: "Building Sonir Bench"
---

I'm building Sonir Bench, a macOS app that captures everything your Mac plays, runs it through a DSP chain you design, and sends it to your DAC. The [first post in this series](https://dev.to/nadai/i-built-a-mac-app-that-routes-all-system-audio-through-a-dsp-chain-you-design-yourself-18co) was the overview. This one goes deep on a single piece: long FIR convolution.

Here's the result up front. On an M6 Mac mini, I ran a 998,545-tap linear-phase FIR at 768 kHz in f64 for almost eight hours. Zero dropouts: no underruns, no overruns, no missed deadlines.

The round-trip latency was 657.43 ms. But 650.09 ms of that is the filter's own group delay. The machinery that moves the audio adds only 7.33 ms. It took me a few wrong turns to learn to keep those two numbers apart.

## Direct convolution buys you about 1 ms

Bench upsamples everything to 705.6 kHz (the 44.1 kHz family) or 768 kHz (the 48 kHz family) before processing. The upsampling filter itself is user-designed: you pick the transition band and tap count.

The first thing I measured was direct convolution, one multiply-add per tap per sample. At 705.6 kHz stereo, one core tops out at 757 taps. That's about 1 ms of impulse response. Not enough for a steep resampling filter, let alone room correction.

So the convolver is a uniformly partitioned FFT convolution (overlap-save):

```text
Split the IR into K partitions of length B → FFT each to 2B points, keep them

Every B samples:
  FFT the latest 2B input samples → push onto the frequency-domain delay line (FDL)
  Σ_k FDL[p−k] · IR_k → inverse FFT → the second half (B samples) is valid output
```

Here's one hop for one channel, lightly trimmed (error handling removed, comments translated):

```rust
// 1. FFT the latest 2B samples (forward FFT clobbers its input, so copy first)
for (dst, src) in self.time.iter_mut().zip(history) {
    *dst = T::from_bus(*src);
}
self.fft.process_with_scratch(&mut self.time, &mut self.spectrum, &mut self.fft_scratch)?;

// 2. Store it in the FDL
let slot = (ch * partitions + fdl_pos) * bins;
self.fdl[slot..slot + bins].copy_from_slice(&self.spectrum);

// 3. Σ_k FDL[pos−k] · IR_k
self.acc.fill(Self::zero());
for k in 0..partitions {
    let idx = (fdl_pos + partitions - k) % partitions;
    let x = (ch * partitions + idx) * bins;
    let h = k * bins;
    T::mul_add_mono(&mut self.acc, &self.fdl[x..x + bins], &self.ir_spectra[h..h + bins]);
}

// 4. Inverse FFT
self.spectrum.copy_from_slice(&self.acc);
self.ifft.process_with_scratch(&mut self.spectrum, &mut self.time, &mut self.ifft_scratch)?;

// 5. Overlap-save: only the second B samples are valid. realfft doesn't normalize, hence 1/2B
let norm = 1.0 / (2 * b) as f64;
for (dst, src) in out.iter_mut().zip(&self.time[b..]) {
    *dst = src.to_bus() * norm;
}
```

The FFT is [realfft](https://crates.io/crates/realfft). The FFTs aren't where the time goes, though. Step 3 is: K complex multiply-accumulates over B + 1 bins, every hop. `mul_add_mono` is hand-written NEON, and in stereo the IR spectrum is loaded once and applied to both channels. For a million taps the IR spectrum is about 17 MB of f64 complex numbers, and every hop reads all of it, so halving the reads is a direct speedup.

Per-sample cost is roughly `12·N/B` for N taps: linear in taps, divided by the partition length. Measured on an Apple M1, 705.6 kHz stereo, as a share of one core:

| taps \ B | 1,024 | 4,096 | 16,384 | 65,536 |
|---:|---:|---:|---:|---:|
| 65,537 | 21.6% | 7.6% | 3.7% | 2.4% |
| 300,001 | 38.2% | 10.9% | 4.3% | 2.7% |
| 1,048,576 | 154.5% | 33.9% | 9.5% | 4.0% |

The same million taps doesn't fit in a core at B = 1,024 and costs 4% at B = 65,536. B matters more than the tap count.

## Partitioning without adding latency

Textbooks say a partitioned convolver has a latency of B. That assumes the host's block size is smaller than B. Plugin hosts typically use 64 to 512 samples, so if you pick a large B for efficiency, you have to buffer input until you have B samples, and that buffering is the latency.

If the host's block size is a multiple of B, there's nothing to buffer. You convolve the block you were handed and return a block of the same length.

Bench's internal block length is the entry block length times the interpolation ratio. Take 256 frames at 48 kHz, upsample 16×, and you get 4,096 frames at 768 kHz. So B is set to the internal block length itself, and the convolver adds zero latency.

B is the largest power of two that divides the block length:

```rust
pub fn partition_for(block: usize) -> Option<usize> {
    if block == 0 {
        return None;
    }
    // Largest power of two dividing the block (= its lowest set bit).
    // If the block is a power of two, that's the block itself
    let b = block & block.wrapping_neg();
    (b >= MIN_PARTITION).then_some(b)
}
```

`block & block.wrapping_neg()` keeps only the lowest set bit in two's complement: 4,096 gives 4,096, and 6,144 gives 2,048.

A test pins this down. It builds the chain with a unit-impulse IR and checks the path latency is identical to an empty chain:

```rust
#[test]
fn a_default_partition_convolver_adds_no_latency_to_the_chain() {
    let empty = Chain::build(&spec_48(256), Vec::new(), config()).unwrap();
    let baseline = empty.report().latency_base_frames;

    // Unit impulse = pass-through IR. We only care about delay
    let mut ir = vec![0.0; DEFAULT_PARTITION * 128];
    ir[0] = 1.0;
    let conv = FirConvolver::new(ir, DEFAULT_PARTITION).unwrap();
    let chain = Chain::build(&spec_48(256), vec![Box::new(conv)], config()).unwrap();

    assert_eq!(chain.report().node_report.latency_frames(), 0);
    assert_eq!(
        chain.report().latency_base_frames,
        baseline,
        "adding the convolver increased path latency"
    );
}
```

Reporting zero latency and actually having zero latency are different claims, so a second test pushes a sine through the same chain and checks the output lines up with the input at the reported delay.

The latency hasn't vanished, though. A bigger B means a bigger entry block, and the round trip grows with it. B is an exchange rate between latency and CPU, and Bench lets you pick it in the UI (4,096 to 65,536).

## Failure 1: 1.37 seconds of wrong output after every swap

Bench can swap the processing chain while audio is playing. You build two chains, A and B, and switch between them with a 5 to 10 ms crossfade to compare by ear.

The first version started each new convolver from empty. A partitioned convolver keeps the spectra of the last K input blocks in its FDL, so starting empty means wrong output until the FDL fills. With a long IR that took up to 1.37 seconds. No 10 ms crossfade hides that.

The fix came from noticing that the FDL holds spectra of the *input*. It doesn't depend on the IR at all. Hand the old convolver's FDL to the new one and the new one is correct from its first block. That's `transfer_history`:

```rust
pub fn transfer_history(&mut self, previous: &Self) -> bool {
    if self.partition != previous.partition
        || self.channels != previous.channels
        || self.bins != previous.bins
        || self.precision != previous.precision
        // ...
    {
        return false;
    }
    // Input-side state carries over as is
    self.history.copy_from_slice(&previous.history);
    self.stage.copy_from_slice(&previous.stage);
    self.fill = previous.fill;

    // Re-pack the FDL newest-first. K may differ, so positions are remapped
    // (a precision mismatch means a different FDL type; the guard above already bailed)
    let geo = self.geometry();
    let (channels, previous_partitions, previous_pos) =
        (self.channels, previous.partitions, previous.fdl_pos);
    let (Some(next), Some(old)) = (self.freq.as_mut(), previous.freq.as_ref()) else {
        return false;
    };
    match (next, old) {
        (FreqDomain::F64(next), FreqDomain::F64(old)) => {
            next.transfer_fdl(old, geo, channels, previous_partitions, previous_pos);
        }
        (FreqDomain::F32(next), FreqDomain::F32(old)) => {
            next.transfer_fdl(old, geo, channels, previous_partitions, previous_pos);
        }
        _ => return false,
    }

    // Don't carry the output side over. The old graph keeps emitting the same
    // blocks during the crossfade, so its pending output would play twice
    self.pending.fill(0.0);
    // ...
}
```

A new tap count means a new K, but re-packing newest-first handles that. If K grows, the oldest slots stay zero and only the tail of the new IR is missing for a few hops. That's orders of magnitude better than starting from nothing, so I accept it.

The output side is the other trap. During the crossfade the old chain is still producing the same blocks, so carrying its pending output over would play that audio twice. Only the input side transfers.

The transfer only works when B, the channel count and the precision all match. That implies a rule: never derive B, or the choice of implementation, from anything a swap can change, such as the tap count. I went on to break that rule twice.

One more thing: a longer crossfade isn't safer. Both chains run for its whole duration, which doubles the CPU load, and a longer fade means a longer stretch at double load. The crossfade is clamped to 5 to 10 ms.

## Failure 2: 300k taps and a stuttering mess

One day a 300k-tap resampling filter turned the output into a string of clicks. Design-time validation had said the filter was fine.

The resampling stage turned out not to use the partitioned FFT convolver at all. It ran a direct polyphase filter. Polyphase saves you a factor of the interpolation ratio, 1/16 at 16×, and I'd assumed that made it cheap. Wrong comparison. Polyphase is still `O(N)` per sample against `O(N/B)` for the FFT path, and a constant factor of 1/16 can't beat a different complexity class. At 300k taps, stereo, 44.1 kHz in, it needed about 35 cores' worth of time, so it missed every single block.

The fix was one convolution engine. The FIR node in the graph and the resampling stages now share the same partitioned convolver.

My first version switched implementations by tap count: direct below a threshold, FFT above. A test then showed that a swap crossing the threshold changed the implementation, so `transfer_history` refused and the audio dropped out, all because you nudged a design parameter. Since FFT was cheaper even at the default 1,345 taps, I deleted the switch.

## Failure 3: the limit wasn't the CPU

The next investigation started from this: "On an M1 Air, 300k taps looks like the real-time ceiling. The compute estimate is two orders of magnitude below what the machine can do. Is something other than raw compute the bottleneck?"

I went through thermal throttling, being scheduled on an E-core, allocation on the real-time thread, and memory bandwidth. None of them. The machine never got hot because the whole pipeline used one core out of eight.

The cause was one line:

```rust
// How B was chosen (at the time)
DEFAULT_PARTITION.min(block)
```

However long the internal block, B never went above 4,096. That cap came from a 20 ms round-trip latency budget, and the reason for that budget had already gone away (next section). When the premise died, nobody went back to revisit what had been built on it.

I made B follow the internal block length and removed the cap. That opened the hole next to it. If B is longer than the block, the convolver can't complete a hop and fills the output with silence, without any error. Nothing in the path looks wrong, and silence plays. B is now derived from the block length the device actually delivers, and blocks that couldn't be filled are counted and shown in the UI.

To count them, `process` now returns the number of frames it actually wrote:

```rust
/// Returns the number of frames that received convolution output. The rest is filled with silence.
pub fn process(&mut self, input: &[f64], output: &mut [f64]) -> usize {
    // ...
    // 1. Accumulate input; run one hop every time B samples are buffered
    let mut done = 0usize;
    while done < frames {
        let take = (b - self.fill).min(frames - done);
        // ... (copy into stage)
        self.fill += take;
        done += take;
        if self.fill == b {
            self.hop();
            self.fill = 0;
        }
    }

    // 2. Emit output. Silence if there isn't enough
    let emit = frames.min(self.available);
    // ... (copy from pending to output, zero-fill the rest)
    self.available -= emit;
    emit
}
```

When the block length equals B, each call runs exactly one hop and returns what it was given. That's the whole zero-latency trick from earlier. When B is longer than the block, calls before B samples have accumulated run no hop and `emit` is 0. The output buffer still has the right length, so nobody notices unless they check the return value.

## The latency was the filter

This is the part I most wanted to write about.

Bench's round-trip latency target is 20 ms. Browser video and games go through it too, so lip sync puts the ceiling around there. Originally, designs that exceeded it couldn't be saved.

But a linear-phase FIR with N taps always has a group delay of `(N−1)/2` samples. At 300k taps that's 212 ms of group delay alone, ten times the budget. Making the convolver add zero latency didn't matter when the filter itself carried an order of magnitude more.

The UI makes it obvious. Here's an upsampler designed at 500k taps, built for 48 kHz input. The latency panel (labels translated):

| Segment | ms |
|---|---:|
| Input | 5.33 |
| IPC | 1.00 |
| Upsampler | 354.60 |
| Node chain | 0.00 |
| Decimator | 0.00 |
| DAC | 1.00 |
| **Total** | **361.94** |

At 768 kHz the same transition band needs 8.8% more taps than at 705.6 kHz, so the upsampler was built with 544,673 taps. Its 354.60 ms is (544,673 − 1) / 2 = 272,336 samples at 768 kHz. Everything else (input 5.33, IPC 1.00, DAC 1.00) adds up to 7.33 ms. The DAC was fed 768 kHz directly, so there's no decimator and it shows 0.00 ms.

The odd tap count is deliberate. 272,336 is exactly 17,021 × 16, a multiple of the interpolation ratio. Otherwise the delay would be a fractional number of samples at the input rate, and the latency couldn't be reported as whole frames. For linear phase, the tap count gets bumped up slightly to make it line up:

```rust
/// Align a linear-phase tap count to the conversion ratio: grow it until the group
/// delay `(N−1)/2` is a whole number of frames at the lower rate
fn align_taps(requested: usize, phase: FirPhase, factor: usize) -> Option<(usize, u32)> {
    match phase {
        FirPhase::Linear => {
            let aligned = ((requested - 1) / 2).div_ceil(factor) * factor;
            let taps = aligned * 2 + 1;
            (taps <= MAX_TAPS).then(|| (taps, u32::try_from(aligned).unwrap_or(u32::MAX)))
        }
        FirPhase::Minimum => Some((requested, 0)),
    }
}
```

The extra taps aren't zero padding. They go inside the window and the filter is redesigned with them, because if you're paying the CPU anyway, it should buy filter performance. Minimum-phase filters don't have a `(N−1)/2` group delay, so there's nothing to align.

Now roughly double the taps: 96 kHz input, a 998,545-tap upsampler, and an 18-node chain behind it. The upsampler alone is 650.09 ms (499,272 samples), for a total of 657.43 ms. Input, IPC and DAC are still 7.33 ms. At 96 kHz the interpolation ratio is 8×, so the entry block is 512 frames, which is still 5.33 ms. The 18 nodes add 0.00 ms.

Double the taps and the filter's delay roughly doubles. The plumbing stays where it was.

## Stop refusing latency

Linear-phase group delay is a pure delay, constant across the band. It doesn't change the sound by a single bit. What it costs you is lip sync, and transport response (when you pause or skip, the delay's worth of audio is still in the pipe). Both are costs the user is entitled to decide to pay.

So Bench no longer refuses designs over the latency budget. It shows the current round-trip latency at all times instead. The bar isn't clipped at 20 ms; it extends to the actual value and keeps a line at the 20 ms mark. The condition is that nobody uses it without knowing, and the decision only stands as long as that display does.

CPU got the same treatment. For a while there was a gate that refused designs predicted to overload the CPU. But the prediction moves by 1.75× with thermal state alone, so passing the gate never guaranteed real-time performance. A gate that says yes reads as "this will be fine," which is exactly the wrong message. The gate became a forecast: the expected load at design time, then the measured load and dropout counts once it's playing.

## Two CPU numbers

The status bar shows two numbers: "CPU load 46% (peak 77%)" and "CPU 46%".

There used to be one: callback wall-clock time divided by the block deadline. Then I noticed that changing the entry block from 256 to 512 frames, same design, made it jump from 7.0% to 22.2%. Still zero dropouts, and the forecast barely moved. The jump was a step, not a slope, so my theory was that longer callbacks were spanning scheduler quanta and the measurement was counting time spent preempted.

To test that, I measured the thread's own CPU time separately. Rust's standard library has no API for thread CPU time, so this is one line of `unsafe`:

```rust
/// CPU time consumed so far by the calling thread.
pub fn thread_cpu_time() -> Option<Duration> {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid `timespec` and `clock_gettime` only writes to it.
    let ok = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &raw mut ts) } == 0;
    // ...
}
```

A call costs about 154 ns, twice per block. Against the 5.8 ms deadline of 256 frames at 44.1 kHz that's 0.005%, so measuring doesn't disturb what's being measured.

The result: wall clock and CPU time agreed to within 0.1 percentage points at every B. The jump wasn't preemption. The work really had grown, and my explanation was the thing that was wrong. I still haven't tracked down why the forecast misses it.

Splitting them was still worth it. I can only say the two agree because I measured them separately. With one number I'd never have gotten past "probably preemption." Both are shown now:

- **CPU load** (wall clock ÷ deadline): are we making the deadline? Includes time spent waiting. At 100%, audio drops out.
- **CPU** (thread CPU time ÷ deadline): pure compute. Used to check the forecast.

Over the eight-hour run, peak load was 77%, so even the worst block left about 20% headroom.

One caveat: this run had a single resampling stage. Output stayed at 768 kHz, so there was no stage bringing the rate back down. With a DAC that tops out at 192 kHz, a second filter runs on the way out, and you pay its CPU too.

These numbers are for f64 convolution. Bench also has a mode that runs only the frequency-domain part in f32, which is about 2× faster for the same design with error around −141 dBFS. You can't switch it while playing, though: the FDL type changes, so `transfer_history` can't carry state across.

## Takeaways

- Direct convolution at 705.6 kHz stereo caps out at 757 taps per core. Partitioned FFT convolution gets a million taps into real time.
- If the internal block length equals the partition length B, the convolver adds zero samples of latency. The price is that a bigger B means a bigger entry block.
- Never derive B or the implementation from anything a swap can change, like tap count. The FDL can't transfer, and a small design tweak becomes a dropout.
- Almost all of the round-trip delay is the filter's group delay, not the plumbing: 650 ms for a million-tap linear-phase filter versus 7 ms to move the audio.
- Neither latency nor CPU load is refused anymore. Both are shown: latency as the sum of each segment's reported value, CPU as a measurement.

## Not done yet

- The latency figures are the sum of what each segment reports. The group delay is exact by construction, but nothing here was measured with a loopback recording. The 1.00 ms IPC figure is an estimate, and since no audio actually crosses a process boundary, it's a segment with nothing behind it.
- Convolution runs on one core. This stage is limited by memory traffic more than arithmetic, so more cores wouldn't scale linearly. I did the f32 frequency domain first (2.05×) and left parallelism for later.
- Low latency and very long filters together would need non-uniform partitioning. Not implemented.

## Try it

Sonir Bench is free during the beta. It runs on Apple Silicon Macs with macOS 13 or later.

https://sonir.app

---

Sonir Bench: https://sonir.app
Author: https://nadai.dev
