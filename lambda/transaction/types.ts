export interface PlanRepository {
  findById(id: string): Promise<any>;
  update(plan: any): Promise<void>;
}

export interface TransactionRepository {
  create(transaction: any): Promise<void>;
}

export interface EventBus {
  publish(event: any): Promise<void>;
}

export interface Metrics {
  increment(metric: string): void;
  gauge(metric: string, value: number): void;
  timing(metric: string, time: number): void;
}

export interface Plan {
  id: string;
  userId: string;
  amount: number;
  frequency: string;
  status: string;
  nextExecutionDate: Date;
  lastExecutionDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
