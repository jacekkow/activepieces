import {
    TriggerBase,
    TriggerStrategy,
    WebhookRenewStrategy,
} from '@activepieces/pieces-framework'
import { exceptionHandler, UserInteractionJobType } from '@activepieces/server-shared'
import {
    FlowVersion,
    PieceTrigger,
    ProjectId,
    TriggerHookType,
    TriggerType,
} from '@activepieces/shared'
import { EngineHelperResponse, EngineHelperTriggerResult, webhookUtils } from 'server-worker'
import { appEventRoutingService } from '../../../app-event-routing/app-event-routing.service'
import { jobQueue } from '../../../workers/queue'
import { userInteractionWatcher } from '../../../workers/user-interaction-watcher'
import { triggerUtils } from './trigger-utils'

export const disablePieceTrigger = async (
    params: DisableParams,
): Promise<EngineHelperResponse<
EngineHelperTriggerResult<TriggerHookType.ON_DISABLE>
> | null> => {
    const { flowVersion, projectId, simulate } = params
    if (flowVersion.trigger.type !== TriggerType.PIECE) {
        return null
    }
    const flowTrigger = flowVersion.trigger as PieceTrigger
    const pieceTrigger = await triggerUtils.getPieceTrigger({
        trigger: flowTrigger,
        projectId,
    })

    if (!pieceTrigger) {
        return null
    }

    try {
        const result = await userInteractionWatcher.submitAndWaitForResponse<EngineHelperResponse<EngineHelperTriggerResult<TriggerHookType.ON_DISABLE>>>({
            jobType: UserInteractionJobType.EXECUTE_TRIGGER_HOOK,
            hookType: TriggerHookType.ON_DISABLE,
            flowVersion,
            webhookUrl: await webhookUtils.getWebhookUrl({
                flowId: flowVersion.flowId,
                simulate,
            }),
            test: simulate,
            projectId,
        })
        return result
    }
    catch (error) {
        if (!params.ignoreError) {
            exceptionHandler.handle(error)
            throw error
        }
        return null
    }
    finally {
        await sideeffect(pieceTrigger, projectId, flowVersion)
    }
}

async function sideeffect(
    pieceTrigger: TriggerBase,
    projectId: string,
    flowVersion: FlowVersion,
): Promise<void> {
    switch (pieceTrigger.type) {
        case TriggerStrategy.APP_WEBHOOK:
            await appEventRoutingService.deleteListeners({
                projectId,
                flowId: flowVersion.flowId,
            })
            break
        case TriggerStrategy.WEBHOOK: {
            const renewConfiguration = pieceTrigger.renewConfiguration
            if (renewConfiguration?.strategy === WebhookRenewStrategy.CRON) {
                await jobQueue.removeRepeatingJob({
                    flowVersionId: flowVersion.id,
                })
            }
            break
        }
        case TriggerStrategy.POLLING:
            await jobQueue.removeRepeatingJob({
                flowVersionId: flowVersion.id,
            })
            break
    }
}
type DisableParams = {
    projectId: ProjectId
    flowVersion: FlowVersion
    simulate: boolean
    ignoreError?: boolean
}
