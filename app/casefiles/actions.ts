"use server";

import { revalidatePath } from "next/cache";
import { decideReview, type ReviewOutcome, type ReviewRequest } from "@/lib/review-action";

/**
 * The analyst's decision from the casefile screen. It calls `submitReview`
 * directly, on the server; `POST /api/review` stays the documented webhook and
 * is not routed through. The reviewer is recorded by the UI, not authenticated
 * here (the same model as covenant approval).
 */
export async function reviewCasefile(request: ReviewRequest): Promise<ReviewOutcome> {
  return decideReview(request, { revalidate: revalidatePath });
}
