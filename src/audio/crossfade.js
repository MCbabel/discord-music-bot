/**
 * Crossfade utility — smooth volume fading for AudioResource objects.
 *
 * Uses setInterval at ~100ms intervals for perceptually smooth transitions.
 * Pure utility module with no state — all fade state is contained in the
 * returned promise/handle.
 */

/** Interval between volume steps in milliseconds (100ms = smoother than 50ms under load). */
const FADE_INTERVAL_MS = 100;

/** Minimum non-zero starting volume for fade-in to avoid silence-to-signal pop. */
const FADE_IN_FLOOR = 0.05;

/**
 * Smoothly fade the volume of an AudioResource over a duration.
 * Automatically aborts if the resource's volume handle becomes unavailable mid-fade.
 * For fade-in, clamps the starting volume to FADE_IN_FLOOR to prevent audible "pop".
 * @param {import('@discordjs/voice').AudioResource} resource - The audio resource with inlineVolume
 * @param {number} fromVol - Starting volume (0-1)
 * @param {number} toVol - Target volume (0-1)
 * @param {number} durationMs - Fade duration in milliseconds
 * @returns {Promise<void>} Resolves when fade is complete or aborted
 */
export function fadeVolume(resource, fromVol, toVol, durationMs) {
    const direction = toVol > fromVol ? 'IN' : 'OUT';

    // For fade-in, enforce a minimum starting volume to avoid the silence→signal artifact
    if (direction === 'IN' && fromVol < FADE_IN_FLOOR) {
        fromVol = FADE_IN_FLOOR;
    }

    // Guard against negative or zero duration
    const safeDuration = Math.max(FADE_INTERVAL_MS, durationMs);

    return new Promise(resolve => {
        if (!resource?.volume) {
            resolve();
            return;
        }

        const steps = Math.max(1, Math.floor(safeDuration / FADE_INTERVAL_MS));
        const stepSize = (toVol - fromVol) / steps;
        let currentStep = 0;

        resource.volume.setVolume(fromVol);

        const interval = setInterval(() => {
            // Abort if resource was destroyed mid-fade (prevents errors and ghost intervals)
            if (!resource?.volume) {
                clearInterval(interval);
                resolve();
                return;
            }

            currentStep++;

            if (currentStep >= steps) {
                resource.volume.setVolume(toVol);
                clearInterval(interval);
                resolve();
            } else {
                const newVol = fromVol + stepSize * currentStep;
                resource.volume.setVolume(newVol);
            }
        }, FADE_INTERVAL_MS);
    });
}

export default { fadeVolume };
