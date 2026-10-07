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

const EVENT_HEAD_SHA = 'event-head-sha'
const OLDER_SHA = 'older-sha'
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

  it('keeps an approval of the event head SHA', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: EVENT_HEAD_SHA }
      }
    }
    listReviews.mockResolvedValue(
      reviewsResponse([review(101, 'APPROVED', EVENT_HEAD_SHA)])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(pullsGet).not.toHaveBeenCalled()
    expect(listReviews).toHaveBeenCalled()
    expect(dismissReview).not.toHaveBeenCalled()
  })

  it('dismisses an approval of an older SHA', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: EVENT_HEAD_SHA }
      }
    }
    listReviews.mockResolvedValue(
      reviewsResponse([
        review(201, 'APPROVED', OLDER_SHA),
        review(202, 'COMMENTED', OLDER_SHA),
        review(203, 'CHANGES_REQUESTED', OLDER_SHA)
      ])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(pullsGet).not.toHaveBeenCalled()
    expect(dismissReview).toHaveBeenCalledTimes(1)
    expect(dismissReview).toHaveBeenCalledWith({
      owner: 'x-clients',
      repo: 'x-android',
      pull_number: 42,
      review_id: 201,
      message: REASON
    })
  })

  it('dismisses an approval with no commit_id and logs the review id', async () => {
    github.context.payload = {
      pull_request: {
        number: 42,
        head: { sha: EVENT_HEAD_SHA }
      }
    }
    listReviews.mockResolvedValue(
      reviewsResponse([
        review(501, 'APPROVED', null),
        review(502, 'APPROVED', EVENT_HEAD_SHA)
      ])
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(pullsGet).not.toHaveBeenCalled()
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
})
