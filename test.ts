type Ref<T extends { x: any }> = T;

type test69 = Ref<{ _id: string, x:string }>