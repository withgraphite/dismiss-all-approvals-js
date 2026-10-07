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
      approvals,
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

type Approval = {
  id: number
  commit_id: string | null
}

async function getPullRequestHeadSha({
  octokit,
  prNumber
}: {
  octokit: Octokit
  prNumber: number
}): Promise<string> {
  const pullRequest = await octokit.rest.pulls.get({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: prNumber
  })

  return pullRequest.data.head.sha
}

async function getPullRequestApprovals({
  octokit,
  prNumber
}: {
  octokit: Octokit
  prNumber: number
}): Promise<Approval[]> {
  const headSha = await getPullRequestHeadSha({ octokit, prNumber })
  const approvals: Approval[] = []

  for (let page = 1; ; ++page) {
    const result = await octokit.rest.pulls.listReviews({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: prNumber,
      page: page
    })

    for (const review of result.data) {
      if (review.state !== 'APPROVED') {
        continue
      }

      if (!review.commit_id) {
        core.info(`Review ${review.id} is missing commit_id; dismissing it`)
        approvals.push({ id: review.id, commit_id: null })
        continue
      }

      if (review.commit_id !== headSha) {
        approvals.push({ id: review.id, commit_id: review.commit_id })
      }
    }

    if (!result.headers.link || !result.headers.link.includes('rel="next"')) {
      break
    }
  }

  return approvals
}

async function dismissApprovals({
  approvals,
  octokit,
  prNumber,
  reason
}: {
  approvals: Approval[]
  octokit: Octokit
  prNumber: number
  reason: string
}): Promise<void> {
  if (approvals.length === 0) {
    return
  }

  if (core.getBooleanInput('dry-run')) {
    await octokit.rest.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: prNumber,
      body: `dismiss_stale_approvals dry run: Would have dismissed ${approvals.length} approvals with reason:\n\n${reason}`
    })
    return
  }

  await Promise.all(
    approvals.map(async approval => {
      // The head can move after listReviews. Fetch it again immediately
      // before dismissing so an approval of the live head is kept.
      const headSha = await getPullRequestHeadSha({ octokit, prNumber })
      if (approval.commit_id === headSha) {
        return
      }

      await octokit.rest.pulls.dismissReview({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        pull_number: prNumber,
        review_id: approval.id,
        message: reason
      })
    })
  )
}
