---
title: "Show HN: Sonir Bench – Run all Mac audio through a DSP chain you design"
url: "https://sonir.app"
---

<!-- 投稿の直後に自分で付ける最初のコメント -->

Hi HN, I'm the developer. Sonir Bench is a macOS app that installs a virtual audio device, captures whatever your Mac plays (Spotify, Apple Music, a browser, anything), runs it through a processing chain you design, and outputs to your DAC.

Why: playback software for audio enthusiasts tends to give you a menu of filters, while filter design tools stop at an exported file. I wanted the loop closed in one place: design a filter, look at its response, A/B it live against another one on my own system, measure.

Some details that might be interesting here:

- The virtual device is my own AudioServerPlugIn. It has no volume control and advertises both the 44.1k and 48k families, so macOS doesn't resample in front of it
- Processing runs at 705.6k / 768k in f64, so naive nonlinear code like a single tanh doesn't alias, and no oversampling filters are needed
- Resampling filters are user-designed and run as partitioned FFT convolution. The partition length equals the internal block size, so convolution adds zero latency; a 1M-tap filter takes roughly 36 to 50 percent of one M1 core
- Every chain goes through validation before it plays (coefficient checks, a simulation pass for nonlinear stages, a mandatory limiter), and falls back to passthrough if anything fails
- Captured audio can never be written to a file. That's enforced with a type parameter on audio buffers, plus compile_fail doctests
- It measures whether the input is actually untouched rather than claiming bit-perfect. In my tests, Qobuz was bit-exact and Spotify with lossless enabled was not

It's free during the beta, Apple Silicon and macOS 13+ only. Known gaps: no built-in file player yet, and default round-trip latency is about 24 to 27 ms (8 to 10 ms with a smaller block size).

I wrote up the architecture here: https://dev.to/nadai/i-built-a-mac-app-that-routes-all-system-audio-through-a-dsp-chain-you-design-yourself-18co

Happy to answer questions about Core Audio, the DSP side, or anything else.
