# GPU evaluation

Two decisions wait on a GPU:

- **Can we charge?** Paid plans need commercially licensed voices: VoxCPM2 (Apache-2.0) instead of
  MMS-TTS and OmniVoice (CC BY-NC). Is its Khmer clear and fast enough?
- **Is live dictation real-time?** On a laptop CPU each pass of Whisper takes several seconds;
  the blueprint's target is text within 2 seconds of speaking.

`backend/scripts/eval_gpu.py` measures both and writes `eval-results/report.md` with ✅/❌ against
these targets, plus audio samples to listen to:

| Measure | Target |
| --- | --- |
| Live dictation: final text after a pause (p90) | ≤ 2 s |
| Text-to-speech real-time factor | ≤ 0.5 (twice as fast as playback) |
| VoxCPM2 time to first audio (streaming) | ≤ 1 s |
| Voice cloning real-time factor | ≤ 1 |
| Khmer intelligibility (round-trip CER) | VoxCPM2 no worse than MMS |

It also reports Khmer STT accuracy (CER) and speed on FLEURS, and peak GPU memory.

## 1. Rent a GPU

A single **NVIDIA T4 (16 GB)** is enough and is what the blueprint budgets for; an L4 or A10 is
faster. Plan for about an hour, plus ~15 GB of model downloads on the first run.

- **A VM with Docker** (AWS `g4dn.xlarge`, Google Cloud with a T4/L4, Lambda, Vast.ai VMs): use the
  image with the NVIDIA drivers and Container Toolkit preinstalled (for example AWS "Deep Learning
  Base GPU AMI" or GCP "Deep Learning VM"). Use step 2a.
- **A container platform** (RunPod, Vast.ai containers, Colab): Docker isn't available inside;
  pick a PyTorch/CUDA 12 template. Use step 2b.

## 2. Run it

```bash
git clone https://github.com/RithyBondeth/Bondeth-AI.git && cd Bondeth-AI
```

**2a. With Docker** (builds the GPU image, which includes VoxCPM2):

```bash
deploy/gpu/run-eval.sh
```

**2b. Without Docker:**

```bash
deploy/gpu/run-eval-native.sh
```

Options pass through, e.g. `--clips 40` for a more precise STT figure, `--skip omnivoice` to leave
out an engine, or `--skip tts clone` for just STT and dictation.

## 3. Read the results

Copy the folder back (`scp -r user@server:Bondeth-AI/eval-results .`) and open `report.md`. Then
**listen** to the `tts_*` and `clone_*` WAV files: the numbers measure speed and how well our own STT
understands each clip, not how natural it sounds or how much a clone sounds like
`clone_reference.wav`.

**Shut the machine down afterwards**: GPUs bill by the hour.

## What the results decide

- VoxCPM2 meets the targets and sounds right → switch the engines (`BONDETH_TTS_ENGINE=voxcpm`,
  `BONDETH_CLONE_ENGINE=voxcpm`) and paid plans become possible.
- Dictation p90 ≤ 2 s → live dictation can be the headline feature on a GPU server; otherwise
  tune `BONDETH_STT_LIVE_PAUSE_S` or keep `BONDETH_STT_LIVE_PARTIALS=false`.
