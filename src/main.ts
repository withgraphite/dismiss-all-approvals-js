import * as core from '@actions/core'
import * as github from '@actions/github'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true })
    const pr = github.context.payload.pull_request
    if (!pr) {
      throw new Error(
        'event context does not contain pull request data - ensure this action was triggered on a `pull_request` event'
      )
    }
    const octokit = github.getOctokit(token)
    const approvals = await getPullRequestApprovals({
      octokit,
      prNumber: pr.number
    })

    await dismissApprovals({
      approvalIds: approvals.map(approval => approval.id),
      octokit,
      prNumber: pr.number,
      reason: core.getInput('reason', { required: true })
    })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Not Found')) {
        console.warn('Did you set the correct permissions?')
      }
      core.setFailed(error.message)
    }
  }
}

type Octokit = ReturnType<typeof github.getOctokit>

async function getPullRequestApprovals({
  octokit,
  prNumber
}: {
  octokit: Octokit
  prNumber: number
}) {
  const result = await octokit.rest.pulls.listReviews({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber
  })
  return result.data.filter(review => review.state === 'APPROVED')
}

async function dismissApprovals({
  approvalIds,
  octokit,
  prNumber,
  reason
}: {
  approvalIds: number[]
  octokit: Octokit
  prNumber: number
  reason: string
}) {
  if (approvalIds.length === 0) {
    return
  }

  await Promise.all(
    approvalIds.map(approvalId =>
      octokit.rest.pulls.dismissReview({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber,
        review_id: approvalId,
        message: reason
      })
    )
  )
}
