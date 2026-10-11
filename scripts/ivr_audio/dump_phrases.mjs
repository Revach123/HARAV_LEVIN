// מייצא את הביטויים הקבועים של שלוחה 6 כ-JSON (קלט ל-build_audio.py).
// הרצה: node scripts/ivr_audio/dump_phrases.mjs > phrases.json
import { AUDIO_FOLDER, PHRASES, PRONUNCIATIONS, VOICE } from '../../functions/api/_shared/ivr_phrases.js';

process.stdout.write(JSON.stringify({ voice: VOICE, folder: AUDIO_FOLDER, phrases: PHRASES, pronunciations: PRONUNCIATIONS }, null, 1) + '\n');
