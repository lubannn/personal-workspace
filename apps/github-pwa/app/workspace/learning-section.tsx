"use client";

import { LearningAreaPlans } from "./learning-area-plans";
import { LearningRecordsSection, type LearningSectionProps } from "./learning-records-section";
import styles from "./learning-plans.module.css";

export function LearningSection(props: LearningSectionProps & { todayDate: string }) {
  const busy = props.savingArea || props.savingGoal || props.savingActivity || props.savingResource
    || props.savingAreaId !== null || props.savingGoalId !== null || props.savingActivityId !== null || props.savingResourceId !== null;
  const records = [...props.goalItems, ...props.activityItems, ...props.resourceItems].filter((item) => item.record.deleted_at === null).length;
  return <div className={styles.root}>
    <div className={styles.plans}><LearningAreaPlans connection={props.connection} online={props.online} todayDate={props.todayDate}
      items={props.areaItems} loading={props.loading} saving={busy} savingId={props.savingAreaId}
      onCreate={props.onCreateArea} onEdit={props.onEditArea} onStatusChange={props.onAreaStatusChange}
      onDeletionChange={props.onAreaDeletionChange} onRefresh={props.onRefresh} /></div>
    <details className={styles.records}>
      <summary>目标、练习与资料 <span>{records} 条记录</span></summary>
      <LearningRecordsSection {...props} showAreas={false} />
    </details>
  </div>;
}
