// Author: Preston Lee

export interface IdePanelTab {
  id: string;
  type: string;
  title: string;
  icon: string;
  component: any;
  isActive: boolean;
  isClosable: boolean;
  isDirty?: boolean;
  data?: any;
}

export interface IdePanel {
  id: string;
  position: 'left' | 'right' | 'bottom';
  isVisible: boolean;
  size: number;
  activeTabId: string | null;
  tabs: IdePanelTab[];
  minSize: number;
  maxSize: number;
  resizeHandleDirection: 'left' | 'right' | 'top';
}

export interface IdePanelState {
  left: IdePanel;
  right: IdePanel;
  bottom: IdePanel;
}
