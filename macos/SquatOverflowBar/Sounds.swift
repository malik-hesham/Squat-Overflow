import AVFoundation
import SquatCore

/// The break's sounds, like extension/break.js: meme clips play one at a time in each group's turn
/// (extension/lib/memes.js), and voice cues wait for the clips, then replace each other so the
/// newest cue is the one you hear.
@MainActor
final class Sounds: NSObject, AVAudioPlayerDelegate {
    nonisolated static func url(forClip clip: String) -> URL? {
        Bundle.main.url(forResource: clip, withExtension: "m4a", subdirectory: "memes")
    }

    private let store: Store
    private let lang: String
    private let synth = AVSpeechSynthesizer()
    private var queue: [String] = []
    private var player: AVAudioPlayer?
    private var pendingSpeech: String?

    init(store: Store, lang: String) {
        self.store = store
        self.lang = lang
    }

    /// Queues the next clip of a MEMES group ("start", "reps", "done", "unscored").
    func playMeme(_ kind: String) {
        guard let group = Memes.groups[kind] else { return }
        var turns = store.memeTurns()
        let turn = Memes.takeTurn(group, turn: turns[kind])
        turns[kind] = turn.next
        store.setMemeTurns(turns)
        queue.append(turn.clip)
        playNext()
    }

    private var clipBusy: Bool { player?.isPlaying == true || !queue.isEmpty }

    private func playNext() {
        if player?.isPlaying == true { return }
        player = nil
        while !queue.isEmpty {
            let clip = queue.removeFirst()
            guard let url = Self.url(forClip: clip), let p = try? AVAudioPlayer(contentsOf: url) else { continue }
            p.volume = 0.8
            p.delegate = self
            if p.play() {
                player = p
                return
            }
        }
        flushSpeech()
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.playNext() }
    }

    func speak(_ text: String) {
        pendingSpeech = text
        if !clipBusy { flushSpeech() }
    }

    private func flushSpeech() {
        guard let text = pendingSpeech else { return }
        pendingSpeech = nil
        let u = AVSpeechUtterance(string: text)
        u.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * 1.1)
        if lang == "ar" { u.voice = AVSpeechSynthesisVoice(language: "ar-SA") }
        synth.stopSpeaking(at: .immediate)
        synth.speak(u)
    }

    func stopSpeaking() {
        pendingSpeech = nil
        synth.stopSpeaking(at: .immediate)
    }

    func stopAll() {
        stopSpeaking()
        queue = []
        player?.stop()
        player = nil
    }
}
