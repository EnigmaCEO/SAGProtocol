// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockApprovedDestination {
    string public name;

    event FundsReceived(address indexed sender, uint256 amount);

    constructor(string memory name_) {
        name = name_;
    }

    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }
}

contract MockBlockdaemonUsdcDestination is MockApprovedDestination {
    constructor() MockApprovedDestination("Blockdaemon USDC Route") {}
}

contract MockBlockdaemonDotStaking is MockApprovedDestination {
    constructor() MockApprovedDestination("Blockdaemon DOT Staking") {}
}

contract MockSkyDestination is MockApprovedDestination {
    constructor() MockApprovedDestination("SKY Protocol Route") {}
}

contract MockGoldfinchDestination is MockApprovedDestination {
    constructor() MockApprovedDestination("Goldfinch Route") {}
}

contract MockMapleSyrupDestination is MockApprovedDestination {
    constructor() MockApprovedDestination("Maple SYRUP Route") {}
}

contract MockOndoOusgDestination is MockApprovedDestination {
    constructor() MockApprovedDestination("Ondo OUSG Route") {}
}

contract MockPaxgPurchaseAdapter is MockApprovedDestination {
    constructor() MockApprovedDestination("PAXG Purchase Then Hold") {}
}
