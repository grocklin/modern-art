# Modern Art

Play Reiner Knizia's auction game **Modern Art** in your browser against three AI opponents.

**▶ Play: https://grocklin.github.io/modern-art/**

- **Modern version** (`/`): redesigned interface that works on desktop and mobile.
- **Classic version** ([`/classic/`](https://grocklin.github.io/modern-art/classic/)): close to the original 2005 Windows look.

## About

This is a web port of a Visual Basic 6 program Gabriel Rocklin wrote in 2005–06.

- **Bidding AI:** a 95-40-1 neural network, one per round, trained with backpropagation and then tuned through self-play.
- **Painting-choice AI:** scores each painting against five goals, using coefficients evolved with a genetic algorithm.
- **Port:** the AI logic and weights are carried over unchanged from the original.

Doubles follow the original German rule: whoever adds the second painting collects the whole price.

Everything is plain HTML, CSS and JavaScript, with no build step and no server.

## Credits and notice

**Modern Art** is a board game designed by Reiner Knizia (© Reiner Knizia). The artist paintings and card art come from the published game; all rights belong to Reiner Knizia and the game's publishers.

This is an **unofficial, non-commercial fan project**. It is not affiliated with or endorsed by the designer or publishers. If you enjoy it, please [buy the real game](https://boardgamegeek.com/boardgame/118/modern-art).

Rights holders: to request changes or removal, please [open an issue](https://github.com/grocklin/modern-art/issues).
