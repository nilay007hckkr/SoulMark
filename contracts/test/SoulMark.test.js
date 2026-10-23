const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const EVENT_ID = ethers.keccak256(ethers.toUtf8Bytes("evt-demo-1"));
const CLAIM_TYPES = {
  Claim: [
    { name: "to", type: "address" },
    { name: "eventId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

async function deployFixture() {
  const [issuer, alice, bob, mallory] = await ethers.getSigners();
  const SoulMark = await ethers.getContractFactory("SoulMark");
  const soul = await SoulMark.deploy(issuer.address);
  await soul.waitForDeployment();
  const { chainId } = await ethers.provider.getNetwork();
  const domain = {
    name: "SoulMark",
    version: "1",
    chainId,
    verifyingContract: await soul.getAddress(),
  };
  const sign = (signer, to, eventId, deadline) =>
    signer.signTypedData(domain, CLAIM_TYPES, { to, eventId, deadline });
  const future = async () => BigInt(await time.latest()) + 3600n;
  return { soul, issuer, alice, bob, mallory, sign, future };
}

// Claims a badge for `to` and returns the minted tokenId.
async function claimFor(ctx, to, eventId = EVENT_ID) {
  const deadline = await ctx.future();
  const sig = await ctx.sign(ctx.issuer, to.address, eventId, deadline);
  await ctx.soul.claim(to.address, eventId, deadline, sig);
  return ctx.soul.badgeOf(to.address, eventId);
}

describe("SoulMark", function () {
  describe("soulbound", function () {
    it("transferFrom reverts Soulbound", async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await claimFor(ctx, ctx.alice);
      await expect(
        ctx.soul.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, id)
      ).to.be.revertedWithCustomError(ctx.soul, "Soulbound");
    });

    it("safeTransferFrom (both overloads) reverts Soulbound", async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await claimFor(ctx, ctx.alice);
      const s = ctx.soul.connect(ctx.alice);
      await expect(
        s["safeTransferFrom(address,address,uint256)"](ctx.alice.address, ctx.bob.address, id)
      ).to.be.revertedWithCustomError(ctx.soul, "Soulbound");
      await expect(
        s["safeTransferFrom(address,address,uint256,bytes)"](ctx.alice.address, ctx.bob.address, id, "0x")
      ).to.be.revertedWithCustomError(ctx.soul, "Soulbound");
    });

    it("approve reverts Soulbound", async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await claimFor(ctx, ctx.alice);
      await expect(
        ctx.soul.connect(ctx.alice).approve(ctx.bob.address, id)
      ).to.be.revertedWithCustomError(ctx.soul, "Soulbound");
    });

    it("setApprovalForAll reverts Soulbound", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(
        ctx.soul.connect(ctx.alice).setApprovalForAll(ctx.bob.address, true)
      ).to.be.revertedWithCustomError(ctx.soul, "Soulbound");
    });

    it("locked() returns true for an existing token", async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await claimFor(ctx, ctx.alice);
      expect(await ctx.soul.locked(id)).to.equal(true);
    });
  });

  describe("claim", function () {
    it("mint emits Locked(tokenId) and hasBadge becomes true", async function () {
      const ctx = await loadFixture(deployFixture);
      const deadline = await ctx.future();
      const sig = await ctx.sign(ctx.issuer, ctx.alice.address, EVENT_ID, deadline);
      // A relayer (bob) submits; the issuer signature is what authorises it.
      await expect(ctx.soul.connect(ctx.bob).claim(ctx.alice.address, EVENT_ID, deadline, sig))
        .to.emit(ctx.soul, "Locked")
        .withArgs(1n);
      expect(await ctx.soul.hasBadge(ctx.alice.address, EVENT_ID)).to.equal(true);
      expect(await ctx.soul.ownerOf(1n)).to.equal(ctx.alice.address);
    });

    it("claiming twice for the same wallet + event reverts AlreadyHasBadge", async function () {
      const ctx = await loadFixture(deployFixture);
      await claimFor(ctx, ctx.alice);
      // Fresh voucher (different deadline => different digest) so VoucherUsed is not what trips.
      const deadline = (await ctx.future()) + 1n;
      const sig = await ctx.sign(ctx.issuer, ctx.alice.address, EVENT_ID, deadline);
      await expect(
        ctx.soul.claim(ctx.alice.address, EVENT_ID, deadline, sig)
      ).to.be.revertedWithCustomError(ctx.soul, "AlreadyHasBadge");
    });

    it("voucher past its deadline reverts VoucherExpired", async function () {
      const ctx = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 60n;
      const sig = await ctx.sign(ctx.issuer, ctx.alice.address, EVENT_ID, deadline);
      await time.increase(120);
      await expect(
        ctx.soul.claim(ctx.alice.address, EVENT_ID, deadline, sig)
      ).to.be.revertedWithCustomError(ctx.soul, "VoucherExpired");
    });

    it("voucher signed by a non-issuer reverts BadSignature", async function () {
      const ctx = await loadFixture(deployFixture);
      const deadline = await ctx.future();
      const sig = await ctx.sign(ctx.mallory, ctx.alice.address, EVENT_ID, deadline);
      await expect(
        ctx.soul.claim(ctx.alice.address, EVENT_ID, deadline, sig)
      ).to.be.revertedWithCustomError(ctx.soul, "BadSignature");
    });

    it("voucher bound to another recipient reverts BadSignature", async function () {
      const ctx = await loadFixture(deployFixture);
      const deadline = await ctx.future();
      const sig = await ctx.sign(ctx.issuer, ctx.alice.address, EVENT_ID, deadline);
      await expect(
        ctx.soul.claim(ctx.mallory.address, EVENT_ID, deadline, sig)
      ).to.be.revertedWithCustomError(ctx.soul, "BadSignature");
    });

    it("replaying a used voucher after revoke reverts VoucherUsed", async function () {
      const ctx = await loadFixture(deployFixture);
      const deadline = await ctx.future();
      const sig = await ctx.sign(ctx.issuer, ctx.alice.address, EVENT_ID, deadline);
      await ctx.soul.claim(ctx.alice.address, EVENT_ID, deadline, sig);
      await ctx.soul.connect(ctx.issuer).revoke(1n);
      await expect(
        ctx.soul.claim(ctx.alice.address, EVENT_ID, deadline, sig)
      ).to.be.revertedWithCustomError(ctx.soul, "VoucherUsed");
    });
  });

  describe("issuer controls", function () {
    it("revoke from a non-issuer reverts NotIssuer", async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await claimFor(ctx, ctx.alice);
      await expect(
        ctx.soul.connect(ctx.alice).revoke(id)
      ).to.be.revertedWithCustomError(ctx.soul, "NotIssuer");
    });

    it("reissue from a non-issuer reverts NotIssuer", async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await claimFor(ctx, ctx.alice);
      await expect(
        ctx.soul.connect(ctx.mallory).reissue(id, ctx.mallory.address)
      ).to.be.revertedWithCustomError(ctx.soul, "NotIssuer");
    });

    it("hasBadge is false after revoke and the token is burned", async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await claimFor(ctx, ctx.alice);
      await ctx.soul.connect(ctx.issuer).revoke(id);
      expect(await ctx.soul.hasBadge(ctx.alice.address, EVENT_ID)).to.equal(false);
      await expect(ctx.soul.ownerOf(id)).to.be.revertedWithCustomError(ctx.soul, "ERC721NonexistentToken");
    });

    it("reissue moves the badge to a new wallet", async function () {
      const ctx = await loadFixture(deployFixture);
      const id = await claimFor(ctx, ctx.alice);
      await expect(ctx.soul.connect(ctx.issuer).reissue(id, ctx.bob.address))
        .to.emit(ctx.soul, "Locked")
        .withArgs(2n);
      expect(await ctx.soul.hasBadge(ctx.alice.address, EVENT_ID)).to.equal(false);
      expect(await ctx.soul.hasBadge(ctx.bob.address, EVENT_ID)).to.equal(true);
      expect(await ctx.soul.ownerOf(2n)).to.equal(ctx.bob.address);
      expect(await ctx.soul.eventOf(2n)).to.equal(EVENT_ID);
    });
  });

  describe("ERC-165", function () {
    it("supportsInterface(0xb45a3c0e) (IERC5192) is true", async function () {
      const { soul } = await loadFixture(deployFixture);
      expect(await soul.supportsInterface("0xb45a3c0e")).to.equal(true);
    });

    it("still reports ERC721 (0x80ac58cd) and rejects 0xffffffff", async function () {
      const { soul } = await loadFixture(deployFixture);
      expect(await soul.supportsInterface("0x80ac58cd")).to.equal(true);
      expect(await soul.supportsInterface("0xffffffff")).to.equal(false);
    });
  });
});
