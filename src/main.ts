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
    const octokit = github.getOctokit(token)
    const approvals = await getPullRequestApprovals({ octokit, pr })

    console.log(approvals.map(approval => approval.id))
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Not Found')) {
        console.warn('Did you set the correct permissions?')
      }
      core.setFailed(error.message)
    }
  }
}

async function getPullRequestApprovals({
  octokit,
  pr
}: {
  octokit: ReturnType<typeof github.getOctokit>
  pr: typeof github.context.payload.pull_request
}) {
  if (!pr) {
    throw new Error(
      'event context does not contain pull request data - ensure this action was triggered on a `pull_request` event'
    )
  }
  console.log(pr)
  const result = await octokit.rest.pulls.listReviews({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: pr.number
  })
  return result.data.filter(review => review.state === 'APPROVED')
}
