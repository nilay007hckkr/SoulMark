// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

contract SoulMark is ERC721, EIP712, IERC5192 {
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(address to,bytes32 eventId,uint256 deadline)");

    address public immutable issuer;
    uint256 private _nextId = 1;

    mapping(address => mapping(bytes32 => uint256)) public badgeOf; // wallet => eventId => tokenId (0 = none)
    mapping(uint256 => bytes32) public eventOf;                      // tokenId => eventId
    mapping(bytes32 => bool) public usedVoucher;                     // EIP-712 digest => used

    error Soulbound();
    error NotIssuer();
    error AlreadyHasBadge();
    error VoucherExpired();
    error VoucherUsed();
    error BadSignature();

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    constructor(address issuer_) ERC721("SoulMark", "SOUL") EIP712("SoulMark", "1") {
        issuer = issuer_;
    }

    /// Anyone may submit (our relayer, or later the attendee's own wallet);
    /// the issuer's EIP-712 signature is what authorises the mint.
    function claim(address to, bytes32 eventId, uint256 deadline, bytes calldata sig)
        external
        returns (uint256)
    {
        if (block.timestamp > deadline) revert VoucherExpired();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, to, eventId, deadline))
        );
        // Marking vouchers used stops a voucher from being replayed after a revoke.
        if (usedVoucher[digest]) revert VoucherUsed();
        if (ECDSA.recover(digest, sig) != issuer) revert BadSignature();
        usedVoucher[digest] = true;
        return _issue(to, eventId);
    }

    function revoke(uint256 tokenId) external onlyIssuer {
        address holder = _requireOwned(tokenId);
        delete badgeOf[holder][eventOf[tokenId]];
        delete eventOf[tokenId];
        _burn(tokenId);
    }

    function reissue(uint256 oldTokenId, address newWallet) external onlyIssuer returns (uint256) {
        address holder = _requireOwned(oldTokenId);
        bytes32 eventId = eventOf[oldTokenId];
        delete badgeOf[holder][eventId];
        delete eventOf[oldTokenId];
        _burn(oldTokenId);
        return _issue(newWallet, eventId);
    }

    function hasBadge(address wallet, bytes32 eventId) external view returns (bool) {
        return badgeOf[wallet][eventId] != 0;
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId // 0xb45a3c0e
            || super.supportsInterface(interfaceId);
    }

    // Soulbound: only mint (from == 0) and burn (to == 0) may move a token.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override { revert Soulbound(); }
    function setApprovalForAll(address, bool) public pure override { revert Soulbound(); }

    function _issue(address to, bytes32 eventId) private returns (uint256 tokenId) {
        if (badgeOf[to][eventId] != 0) revert AlreadyHasBadge();
        tokenId = _nextId++;
        badgeOf[to][eventId] = tokenId;
        eventOf[tokenId] = eventId;
        _mint(to, tokenId); // _mint, not _safeMint: no receiver callback, smaller attack surface
        emit Locked(tokenId);
    }
}
