import {z} from 'zod';
import {ApiError} from './errors.js';

// A conversational preview is never an archived fact. Only confirmed source records
// go through the existing grounded extraction worker.
export const observationReviewSchema=z.object({
 reply:z.string().trim().min(1).max(800),
 nextQuestion:z.string().trim().max(200).default('')
}).strict();
export function validateObservationReview(value){
 const parsed=observationReviewSchema.safeParse(value);
 if(!parsed.success)throw new ApiError(502,'AI_INVALID_RESPONSE');
 return parsed.data;
}
