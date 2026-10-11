import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db, parse, canWatch, audit, type AuthRequest } from './core';
import { AdminGuard, MemberGuard } from './auth';
function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function razor(path: string, body?: unknown) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    throw new ServiceUnavailableException('Payments are not configured yet. Ask your admin.');
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new BadRequestException(
      'Payment provider could not complete this request. Please try again.',
    );
  return response.json();
}
async function reconcile(paymentId: string, expectedOrderId?: string) {
  if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new BadRequestException('Invalid payment ID');
  const payment = await razor(`payments/${paymentId}`);
  const order = await db.order.findUnique({ where: { providerOrderId: payment.order_id } });
  if (
    !order ||
    (expectedOrderId && order.id !== expectedOrderId) ||
    payment.amount !== order.amount ||
    payment.currency !== order.currency
  )
    throw new BadRequestException('Payment does not match the order.');
  if (payment.status === 'refunded' || Number(payment.amount_refunded) > 0) {
    await db.$transaction([
      db.order.update({ where: { id: order.id }, data: { status: 'REFUNDED', paymentId } }),
      db.entitlement.updateMany({ where: { orderId: order.id }, data: { revoked: true } }),
    ]);
    return { status: 'REFUNDED' };
  }
  if (payment.status !== 'captured') return { status: 'PENDING' };
  await db.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: 'CREATED' },
      data: { status: 'PAID', paymentId },
    });
    if (!claimed.count) return;
    await tx.entitlement.create({
      data: {
        userId: order.userId,
        productId: order.productId,
        orderId: order.id,
        expiresAt:
          order.mode === 'RENTAL' ? new Date(Date.now() + order.rentalHours * 3600000) : null,
      },
    });
  });
  return { status: (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status };
}
@Controller('payments')
export class PaymentController {
  @Get('config') @UseGuards(MemberGuard) config() {
    return {
      enabled: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      keyId: process.env.RAZORPAY_KEY_ID || null,
    };
  }
  @Post('orders') @UseGuards(MemberGuard) async create(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const { productId } = parse(z.object({ productId: z.string() }), body);
    const product = await db.product.findUniqueOrThrow({
      where: { id: productId },
      include: { title: true },
    });
    if (
      !product.active ||
      product.mode === 'FREE' ||
      product.title.status !== 'PUBLISHED' ||
      product.title.showcase ||
      (product.title.availableUntil && product.title.availableUntil < new Date())
    )
      throw new BadRequestException('This product is not available to purchase.');
    if (await canWatch(req.user.id, product.titleId))
      throw new BadRequestException('You already have access.');
    const order = await db.order.create({
      data: {
        userId: req.user.id,
        productId,
        amount: product.pricePaise,
        mode: product.mode,
        rentalHours: product.rentalHours,
      },
    });
    const provider = await razor('orders', {
      amount: order.amount,
      currency: 'INR',
      receipt: order.id,
      notes: { orderId: order.id },
    });
    await db.order.update({ where: { id: order.id }, data: { providerOrderId: provider.id } });
    return {
      id: order.id,
      providerOrderId: provider.id,
      amount: order.amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      title: product.title.name,
    };
  }
  @Post('verify') @UseGuards(MemberGuard) async verify(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({
        orderId: z.string(),
        razorpay_payment_id: z.string(),
        razorpay_signature: z.string().length(64),
      }),
      body,
    );
    const order = await db.order.findFirst({ where: { id: input.orderId, userId: req.user.id } });
    if (!order?.providerOrderId || !process.env.RAZORPAY_KEY_SECRET)
      throw new BadRequestException('Order not found.');
    const expected = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${order.providerOrderId}|${input.razorpay_payment_id}`)
      .digest('hex');
    if (!equal(expected, input.razorpay_signature))
      throw new ForbiddenException('Invalid payment signature');
    return reconcile(input.razorpay_payment_id, order.id);
  }
  @Post('webhook') async webhook(@Req() req: RawBodyRequest<Request>) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !req.rawBody) throw new ForbiddenException();
    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string') throw new ForbiddenException();
    const expected = createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (!equal(expected, signature)) throw new ForbiddenException();
    const eventId = String(req.headers['x-razorpay-event-id'] || '');
    if (eventId && (await db.webhookEvent.findUnique({ where: { id: eventId } })))
      return { ok: true };
    const event = JSON.parse(req.rawBody.toString());
    const paymentId =
      event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.payment_id;
    if (paymentId && ['payment.captured', 'order.paid', 'refund.processed'].includes(event.event))
      await reconcile(paymentId);
    if (eventId)
      await db.webhookEvent.upsert({ where: { id: eventId }, create: { id: eventId }, update: {} });
    return { ok: true };
  }
  @Post('refund/:id') @UseGuards(AdminGuard) async refund(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    const order = await db.order.findUniqueOrThrow({ where: { id } });
    if (order.status !== 'PAID' || !order.paymentId)
      throw new BadRequestException('Only captured orders can be refunded.');
    const existing = await razor(`payments/${order.paymentId}/refunds`);
    if (!existing.items?.some((x: { status: string }) => x.status !== 'failed'))
      await razor(`payments/${order.paymentId}/refund`, {
        amount: order.amount,
        notes: { orderId: id },
      });
    await reconcile(order.paymentId, id);
    await audit(req.user.id, 'REFUND_REQUESTED', id);
    return { ok: true };
  }
}
