import { Router, type IRouter } from "express";
import healthRouter from "./health";
import friendsRouter from "./friends";

const router: IRouter = Router();

router.use(healthRouter);
router.use(friendsRouter);

export default router;
