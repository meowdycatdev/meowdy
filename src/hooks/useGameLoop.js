import { useEffect, useState, useRef } from "react";
// --- FIREBASE IMPORTS ---
import { collection, query, where, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../database/firebase"; // adjust path as needed

const jumpSound = new Audio("/assets/jump.ogg");
const gameOverSound = new Audio("/assets/gameover.ogg");
const scoreSound = new Audio("/assets/score.ogg");

const GRAVITY = 0.6;
const FLAP_STRENGTH = -8;
const PIPE_WIDTH = 60;
const PIPE_GAP = 150;
const PIPE_INTERVAL = 2000;
const GAME_HEIGHT = 600;
const GAME_WIDTH = 400;
const Meow_WIDTH = 34;
const Meow_HEIGHT = 24;
const Meow_X = 50;

// Helper function to get background image based on score
function getBackgroundImage(score) {
  const index = Math.min(Math.floor(score / 5), 16);
  return `/assets/background${index}.png`;
}

/**
 * @param {function} onGameOver - called when game ends (after all lives lost)
 * @param {number} nftCount
 * @param {string} walletAddress - user's wallet address
 */
export default function useGameLoop(onGameOver, nftCount = 1, walletAddress = "") {
  const [MeowY, setMeowY] = useState(250);
  const [MeowXPos, setMeowXPos] = useState(Meow_X); // Cat horizontal position
  const [pipes, setPipes] = useState([]);
  const [score, setScore] = useState(0);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [lives, setLives] = useState(nftCount > 0 ? nftCount : 1);
  const [isInvulnerable, setIsInvulnerable] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);
  const [isVibrating, setIsVibrating] = useState(false);

  // --- STATE FOR DELAYED START ---
  const [isStartDelay, setIsStartDelay] = useState(false);
  const startDelayTimeout = useRef(null);

  // --- Ground collision offset ---
  const GROUND_COLLISION_OFFSET = 30;

  const velocity = useRef(0);
  const animationFrameId = useRef(null);
  const gameRunning = useRef(true);

  useEffect(() => {
    setLives(nftCount > 0 ? nftCount : 1);
  }, [nftCount]);

  const generatePipe = () => {
    const height = Math.floor(Math.random() * 200) + 50;
    setPipes((prev) => [...prev, { x: GAME_WIDTH, height, scored: false }]);
  };

  const detectCollision = (MeowY, pipes) => {
    if (isInvulnerable) return false;

    const MeowTop = MeowY;
    const MeowBottom = MeowY + Meow_HEIGHT;
    const MeowLeft = MeowXPos;
    const MeowRight = MeowLeft + Meow_WIDTH;

    for (const pipe of pipes) {
      const pipeLeft = pipe.x;
      const pipeRight = pipe.x + PIPE_WIDTH;

      const topPipeBottom = pipe.height;
      const bottomPipeTop = pipe.height + PIPE_GAP;

      const hitsPipeHorizontally = MeowRight > pipeLeft && MeowLeft < pipeRight;
      const hitsTopPipe = MeowTop < topPipeBottom;
      const hitsBottomPipe = MeowBottom > bottomPipeTop;

      if (hitsPipeHorizontally && (hitsTopPipe || hitsBottomPipe)) {
        return true;
      }
    }

    // Lowered ground collision by +30px
    return MeowBottom >= (GAME_HEIGHT + GROUND_COLLISION_OFFSET);
  };

  // Only generate pipes if game is started and NOT in start delay
  useEffect(() => {
    const interval = setInterval(() => {
      if (gameRunning.current && isGameStarted && !isStartDelay) generatePipe();
    }, PIPE_INTERVAL);
    return () => clearInterval(interval);
  }, [isGameStarted, isStartDelay]);

  useEffect(() => {
    const gameLoop = () => {
      if (!gameRunning.current) return;

      // During start delay: move cat horizontally to Meow_X, but don't apply gravity
      if (isGameStarted && isStartDelay) {
        setMeowXPos((prev) => {
          if (prev < Meow_X) {
            const next = Math.min(prev + 5, Meow_X);
            return next;
          }
          return prev;
        });
      }

      // After delay, normal gameplay
      if (isGameStarted && !isStartDelay) {
        velocity.current += GRAVITY;
        setMeowY((prev) => {
          const nextY = prev + velocity.current;
          // Only clamp to the top, not the bottom, so the cat can go below the ground deathbox
          return Math.max(0, nextY);
        });

        setPipes((prev) => {
          return prev
            .map((pipe) => {
              const newX = pipe.x - 2;
              if (!pipe.scored && newX + PIPE_WIDTH < MeowXPos) {
                pipe.scored = true;
                setScore((s) => s + 1);
                scoreSound.play();
              }
              return { ...pipe, x: newX };
            })
            .filter((pipe) => pipe.x + PIPE_WIDTH > 0);
        });

        if (detectCollision(MeowY, pipes)) {
          handleCollision();
        }
      }

      animationFrameId.current = requestAnimationFrame(gameLoop);
    };

    animationFrameId.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId.current);
    // eslint-disable-next-line
  }, [isGameStarted, MeowY, pipes, isInvulnerable, isStartDelay, MeowXPos]);

  // --- UPDATE HIGHSCORE ON GAME OVER ---
  const updateHighScoreForWallet = async () => {
    if (!walletAddress) {
      console.warn("No wallet address given, skipping update.");
      return;
    }
    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("accountAddress", "==", walletAddress));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const userDoc = snapshot.docs[0];
        const data = userDoc.data();
        if (score > (data.highestScore || 0)) {
          await updateDoc(userDoc.ref, { highestScore: score });
        }
      }
    } catch (e) {
      console.error("Error updating high score:", e);
    }
  };

  const handleCollision = () => {
    setIsVibrating(true);
    setIsBlinking(true);
    setIsInvulnerable(true);
    gameOverSound.play();

    setTimeout(() => {
      setIsVibrating(false);
    }, 1000);

    setTimeout(() => {
      setIsBlinking(false);
      setIsInvulnerable(false);
    }, 3000);

    if (lives > 1) {
      setLives((prev) => prev - 1);
    } else {
      stopGame();
      // On game over, update highscore if needed
      updateHighScoreForWallet().then(() => {
        onGameOver?.();
      });
    }
  };

  const stopGame = () => {
    gameRunning.current = false;
    cancelAnimationFrame(animationFrameId.current);
  };

  const resetGame = () => {
    setMeowY(250);
    setMeowXPos(0); // Start offscreen left for animation
    setPipes([]);
    setScore(0);
    setLives(nftCount > 0 ? nftCount : 1);
    velocity.current = 0;
    setIsGameStarted(false);
    setIsInvulnerable(false);
    setIsBlinking(false);
    setIsVibrating(false);
    setIsStartDelay(false);
    gameRunning.current = true;
  };

  const jump = () => {
    // No jump if not started or during start delay
    if (!isGameStarted || isStartDelay) return;
    if (gameRunning.current && isGameStarted && !isStartDelay) {
      velocity.current = FLAP_STRENGTH;
      jumpSound.play();
    }
  };

  // --- DELAYED START LOGIC ---
  const startGame = () => {
    if (isGameStarted) return; // Already started
    setMeowXPos(0); // Start offscreen left
    setMeowY(250);
    setIsStartDelay(true);
    setIsGameStarted(true);
    startDelayTimeout.current = setTimeout(() => {
      setIsStartDelay(false);
      velocity.current = 0; // reset velocity so cat doesn't drop too fast at start
      setMeowXPos(Meow_X); // Ensure ends up at Meow_X
    }, 500); // 0.5 seconds
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (startDelayTimeout.current) clearTimeout(startDelayTimeout.current);
    };
  }, []);

  const backgroundImage = getBackgroundImage(score);

  return {
    MeowY,
    MeowX: MeowXPos, // Expose for rendering
    pipes,
    score,
    jump,
    stopGame,
    startGame,
    isGameStarted,
    resetGame,
    lives,
    isBlinking,
    isVibrating,
    backgroundImage,
    isStartDelay, // <-- exposed for UI
  };
}
