// Author: Preston Lee

export type IdeContextType = 'Patient' | 'Group';

export interface IdeExecutionSubject {
  reference: string;
  id: string;
  display: string;
}
