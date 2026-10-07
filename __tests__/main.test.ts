/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as main from '../src/main'

const JOB_START_SHA = 'sha-that-started-the-job'
const CURRENT_HEAD_SHA = 'current-head-sha'
const OLDER_SHA = 'older-sha'
const NEWER_SHA = 'newer-head-sha'
const REASON = 'Pull request updated'

type Review = {
  id: number
  state: string
  commit_id: string | null
}

const pullsGet = jest.fn()
const listReviews = jest.fn()
const dismissReview = jest.fn()
const createComment = jest.fn()

function review(id: number, state: string, commitId: string | null): Review {
  return {
    id,
    state,
    commit_id: commitId
  }
}

function pullRequest(sha: string): { data: { head: { sha: string } } } {
  return { data: { head: { sha } } }
}

function reviewsResponse(reviews: Review[]): {
  data: Review[]
  headers: { link?: string }
} {
  return { data: reviews, headers: {} }
}

describe('action', () => {
  let infoMock: jest.SpiedFunction<typeof core.info>
  let setFailedMock: jest.SpiedFunction<typeof core.setFailed>

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GITHUB_REPOSITORY = 'x-clients/x-android'

    jest.spyOn(core, 'getInput').mockImplementation(name => {
      switch (name) {
        case 'github-token':
          return 'token'
        case 'reason':
          return REASON
        default:
          return ''
      }
    })
    jest.spyOn(core, 'getBooleanInput').mockReturnValue(false)
    infoMock = jest.spyOn(core, 'info').mockImplementation()
    setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()

    jest.spyOn(github, 'getOctokit').mockImplementation(() => {
      return {
        rest: {
          pulls: {
            get: pullsGet,
            listReviews,
            dismissReview
          },
          issues: {
            createComment
          }
        }
      } as unknown as ReturnType<typeof github.getOctokit>
    })

    pullsGet.mockReset()
    listReviews.mockReset()
    dismissReview.mockReset()
    createComment.mockReset()
    dismissReview.mockResolvedValue({})
    createComment.mockResolvedValue({})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('keeps an approval of the current head when the head is still the SHA that started the job', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: CURRENT_HEAD_SHA }
      }
    }
    pullsGet.mockResolvedValue(pullRequest(CURRENT_HEAD_SHA))
    listReviews.mockResolvedValue(
      reviewsResponse([review(101, 'APPROVED', CURRENT_HEAD_SHA)])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(pullsGet).toHaveBeenCalledTimes(1)
    expect(pullsGet.mock.invocationCallOrder[0]).toBeLessThan(
      listReviews.mock.invocationCallOrder[0]
    )
    expect(dismissReview).not.toHaveBeenCalled()
  })

  it('dismisses an approval of an older SHA', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: CURRENT_HEAD_SHA }
      }
    }
    pullsGet.mockResolvedValue(pullRequest(CURRENT_HEAD_SHA))
    listReviews.mockResolvedValue(
      reviewsResponse([
        review(201, 'APPROVED', OLDER_SHA),
        review(202, 'COMMENTED', OLDER_SHA),
        review(203, 'CHANGES_REQUESTED', OLDER_SHA)
      ])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(pullsGet).toHaveBeenCalledTimes(2)
    expect(pullsGet.mock.invocationCallOrder[0]).toBeLessThan(
      listReviews.mock.invocationCallOrder[0]
    )
    expect(pullsGet.mock.invocationCallOrder[1]).toBeLessThan(
      dismissReview.mock.invocationCallOrder[0]
    )
    expect(dismissReview).toHaveBeenCalledTimes(1)
    expect(dismissReview).toHaveBeenCalledWith({
      owner: 'x-clients',
      repo: 'x-android',
      pull_number: 42,
      review_id: 201,
      message: REASON
    })
  })

  it('keeps an approval of the newest head when the head moves before reviews are listed', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: JOB_START_SHA }
      }
    }
    pullsGet.mockResolvedValue(pullRequest(NEWER_SHA))
    listReviews.mockResolvedValue(
      reviewsResponse([review(301, 'APPROVED', NEWER_SHA)])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(pullsGet).toHaveBeenCalledTimes(1)
    expect(dismissReview).not.toHaveBeenCalled()
  })

  it('dismisses an approval of the SHA that started the run when the head has moved', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: JOB_START_SHA }
      }
    }
    pullsGet.mockResolvedValue(pullRequest(NEWER_SHA))
    listReviews.mockResolvedValue(
      reviewsResponse([review(401, 'APPROVED', JOB_START_SHA)])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(pullsGet).toHaveBeenCalledTimes(2)
    expect(dismissReview).toHaveBeenCalledTimes(1)
    expect(dismissReview).toHaveBeenCalledWith({
      owner: 'x-clients',
      repo: 'x-android',
      pull_number: 42,
      review_id: 401,
      message: REASON
    })
  })

  it('dismisses an approval with no commit_id and logs the review id', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: CURRENT_HEAD_SHA }
      }
    }
    pullsGet.mockResolvedValue(pullRequest(CURRENT_HEAD_SHA))
    listReviews.mockResolvedValue(
      reviewsResponse([
        review(501, 'APPROVED', null),
        review(502, 'APPROVED', CURRENT_HEAD_SHA)
      ])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(infoMock).toHaveBeenCalledWith(
      'Review 501 is missing commit_id; dismissing it'
    )
    expect(dismissReview).toHaveBeenCalledTimes(1)
    expect(dismissReview).toHaveBeenCalledWith({
      owner: 'x-clients',
      repo: 'x-android',
      pull_number: 42,
      review_id: 501,
      message: REASON
    })
  })

  it('keeps an approval that matches the head fetched immediately before dismissal', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: JOB_START_SHA }
      }
    }
    pullsGet
      .mockResolvedValueOnce(pullRequest(NEWER_SHA))
      .mockResolvedValueOnce(pullRequest(OLDER_SHA))
      .mockResolvedValueOnce(pullRequest(NEWER_SHA))
    listReviews.mockResolvedValue(
      reviewsResponse([
        review(601, 'APPROVED', OLDER_SHA),
        review(602, 'APPROVED', JOB_START_SHA)
      ])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(pullsGet).toHaveBeenCalledTimes(3)
    expect(pullsGet.mock.invocationCallOrder[1]).toBeLessThan(
      dismissReview.mock.invocationCallOrder[0]
    )
    expect(dismissReview).toHaveBeenCalledTimes(1)
    expect(dismissReview).toHaveBeenCalledWith({
      owner: 'x-clients',
      repo: 'x-android',
      pull_number: 42,
      review_id: 602,
      message: REASON
    })
  })
})
